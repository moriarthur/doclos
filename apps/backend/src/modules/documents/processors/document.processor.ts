import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus, DocumentType } from '../entities/document.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { FieldExtraction } from '../entities/field-extraction.entity';
import { Job as JobEntity, JobStatus } from '../../jobs/entities/job.entity';
import { S3Service } from '../../storage/services/s3.service';
import { OcrService } from '../../ocr/services/ocr.service';
import { DocumentClassifierService } from '../../ai/services/document-classifier.service';
import { StructuredExtractionService } from '../../ai/services/structured-extraction.service';

// Part 3: AI Pipeline - Document processing worker
// Part 8: Infrastructure & Deployment - Queue system with BullMQ

interface ProcessDocumentJob {
  documentId: string;
  userId: string;
}

@Processor('documents')
export class DocumentProcessor {
  private readonly logger = new Logger(DocumentProcessor.name);

  constructor(
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
    @InjectRepository(Customer)
    private customersRepository: Repository<Customer>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(InvoiceItem)
    private invoiceItemsRepository: Repository<InvoiceItem>,
    @InjectRepository(FieldExtraction)
    private fieldExtractionsRepository: Repository<FieldExtraction>,
    @InjectRepository(JobEntity)
    private jobsRepository: Repository<JobEntity>,
    private s3Service: S3Service,
    private ocrService: OcrService,
    private documentClassifierService: DocumentClassifierService,
    private structuredExtractionService: StructuredExtractionService,
  ) {}

  @Process({ name: 'process-document', concurrency: 1 })
  async handleProcessDocument(job: Job<ProcessDocumentJob>) {
    const { documentId } = job.data;

    this.logger.log(`Processing document: ${documentId}`);

    // Find or create job record (avoid duplicates for reprocessing)
    let jobRecord = await this.jobsRepository.findOne({
      where: { document_id: documentId, status: JobStatus.PROCESSING },
      order: { created_at: 'DESC' },
    });
    if (!jobRecord) {
      jobRecord = this.jobsRepository.create({
        job_type: 'process_document' as any,
        status: JobStatus.PROCESSING,
        document_id: documentId,
      });
      await this.jobsRepository.save(jobRecord);
    }

    // Helper: check if job was cancelled by user
    const isCancelled = async () => {
      const fresh = await this.jobsRepository.findOne({ where: { id: jobRecord.id } });
      return fresh?.status === JobStatus.FAILED && fresh?.last_error === 'Cancelled by user';
    };

    try {
      const document = await this.documentsRepository.findOne({ where: { id: documentId } });
      if (!document) {
        throw new Error('Document not found');
      }

      // Update status to processing
      document.status = DocumentStatus.PROCESSING;
      await this.documentsRepository.save(document);

      // 1. Download file from S3
      this.logger.log(`Downloading file from S3: ${document.s3_key}`);
      jobRecord.progress = { stage: 'downloading', message: 'Downloading file...' };
      await this.jobsRepository.save(jobRecord);
      const fileBuffer = await this.s3Service.downloadFile(document.s3_key);

      if (await isCancelled()) {
        this.logger.log(`Job cancelled after download: ${documentId}`);
        return;
      }

      // 2. Extract text / OCR
      this.logger.log('Starting OCR processing');
      jobRecord.progress = { stage: 'ocr', message: 'Starting OCR...', current: 0, total: 0 };
      await this.jobsRepository.save(jobRecord);
      const ocrResult = await this.ocrService.processDocument(
        fileBuffer,
        document.mime_type,
        jobRecord,
      );

      if (await isCancelled()) {
        this.logger.log(`Job cancelled after OCR: ${documentId}`);
        return;
      }

      this.logger.log(
        `OCR complete - Category: ${ocrResult.documentCategory}, Confidence: ${(
          ocrResult.confidence * 100
        ).toFixed(1)}%, Pages: ${ocrResult.pageCount}`,
      );

      // Update page count
      document.page_count = ocrResult.pageCount;
      await this.documentsRepository.save(document);

      // 3. Classify document type using LLM
      this.logger.log('Classifying document type');
      jobRecord.progress = { stage: 'classifying', message: 'Classifying document type...' };
      await this.jobsRepository.save(jobRecord);
      const classification = await this.documentClassifierService.classifyDocument(
        ocrResult.text,
      );

      if (await isCancelled()) {
        this.logger.log(`Job cancelled after classification: ${documentId}`);
        return;
      }

      document.type = classification.type;
      await this.documentsRepository.save(document);

      this.logger.log(
        `Document classified as ${classification.type} (confidence: ${classification.confidence})`,
      );

      // 4. Extract structured data with LLM (if invoice)
      if (classification.type === DocumentType.INVOICE) {
        // Rate limit buffer: wait before next GLM API call
        await new Promise(r => setTimeout(r, 3000));
        await this.extractInvoiceData(document, ocrResult.text);
      } else {
        // For non-invoice documents, mark as parsed
        document.status = DocumentStatus.PARSED;
        document.processed_at = new Date();
        await this.documentsRepository.save(document);
      }

      // Update job status
      jobRecord.status = JobStatus.COMPLETED;
      await this.jobsRepository.save(jobRecord);

      this.logger.log(`Document processed: ${documentId}`);
    } catch (error) {
      // Don't overwrite cancellation status
      if (await isCancelled()) {
        this.logger.log(`Job was cancelled, skipping error handling: ${documentId}`);
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Error processing document: ${errorMessage}`);

      // Update job status
      jobRecord.status = JobStatus.FAILED;
      jobRecord.last_error = errorMessage;
      jobRecord.attempts = 1; // Reset to 1 on error
      await this.jobsRepository.save(jobRecord);

      // Update document status
      const document = await this.documentsRepository.findOne({ where: { id: documentId } });
      if (document) {
        document.status = DocumentStatus.ERROR;
        await this.documentsRepository.save(document);
      }

      throw error;
    }
  }

  @Process({ name: 'reprocess-document', concurrency: 1 })
  async handleReprocessDocument(job: Job<ProcessDocumentJob>) {
    const { documentId } = job.data;
    this.logger.log(`Reprocessing document: ${documentId}`);

    // Same logic as process-document
    return this.handleProcessDocument(job);
  }

  /**
   * Extract invoice data using LLM
   * Part 3: AI Pipeline - Structured data extraction
   */
  private async extractInvoiceData(document: Document, extractedText: string) {
    try {
      this.logger.log('Extracting invoice data with LLM');

      // Extract structured data
      const extractionResult = await this.structuredExtractionService.extractInvoiceData(
        extractedText,
      );

      const { data: extraction, confidence, cost } = extractionResult;

      this.logger.log(
        `Extraction complete - Confidence: ${(confidence.overall * 100).toFixed(1)}% (cost: $${cost.toFixed(4)})`,
      );

      // Normalize extraction
      const normalizedExtraction =
        this.structuredExtractionService.normalizeExtraction(extraction);

      // Determine validation requirement based on confidence
      const autoAcceptThreshold = 0.85;
      const needsValidationThreshold = 0.6;
      const hasMissingCurrency = !normalizedExtraction.currency;

      let newStatus: DocumentStatus;
      if (hasMissingCurrency) {
        newStatus = DocumentStatus.NEEDS_VALIDATION;
        this.logger.log('Currency missing - needs validation');
      } else if (confidence.overall >= autoAcceptThreshold) {
        newStatus = DocumentStatus.PARSED;
        this.logger.log('Confidence high - auto-accepting');
      } else if (confidence.overall >= needsValidationThreshold) {
        newStatus = DocumentStatus.NEEDS_VALIDATION;
        this.logger.log('Confidence medium - needs validation');
      } else {
        newStatus = DocumentStatus.NEEDS_VALIDATION;
        this.logger.log('Confidence low - needs validation');
      }

      // Find or create customer
      let customer: Customer | null = null;
      if (normalizedExtraction.supplier_name) {
        const existingCustomer = await this.customersRepository.findOne({
          where: {
            name: normalizedExtraction.supplier_name,
          },
        });

        if (existingCustomer) {
          customer = existingCustomer;
        } else {
          customer = this.customersRepository.create({
            name: normalizedExtraction.supplier_name,
            address: normalizedExtraction.supplier_address || undefined,
          });
          await this.customersRepository.save(customer);
        }

        document.customer_id = customer.id;
      }

      // Create invoice record
      const invoice = new Invoice();
      invoice.document_id = document.id;
      invoice.invoice_number = normalizedExtraction.invoice_number || '';
      invoice.invoice_date = normalizedExtraction.invoice_date
        ? new Date(normalizedExtraction.invoice_date)
        : null as any;
      invoice.due_date = normalizedExtraction.due_date
        ? new Date(normalizedExtraction.due_date)
        : null as any;
      invoice.amount_total = normalizedExtraction.amount_total || 0;
      invoice.vat_amount = normalizedExtraction.vat_amount || 0;
      invoice.currency = normalizedExtraction.currency || '';
      invoice.supplier_name = normalizedExtraction.supplier_name || '';
      invoice.supplier_address = normalizedExtraction.supplier_address || '';
      invoice.validated = confidence.overall >= autoAcceptThreshold;
      await this.invoicesRepository.save(invoice);

      // Link invoice to document
      document.invoiceId = invoice.id;

      // Create invoice items if present
      if (normalizedExtraction.items && normalizedExtraction.items.length > 0) {
        for (const item of normalizedExtraction.items) {
          const invoiceItem = this.invoiceItemsRepository.create({
            invoice_id: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
          });
          await this.invoiceItemsRepository.save(invoiceItem);
        }
      }

      // Create field extractions with confidence scores
      const fieldsToSave = [
        {
          field_name: 'invoice_number',
          value: normalizedExtraction.invoice_number || '',
          confidence: confidence.fields.invoice_number || confidence.overall,
        },
        {
          field_name: 'amount_total',
          value: String(normalizedExtraction.amount_total || ''),
          confidence: confidence.fields.amount_total || confidence.overall,
        },
        {
          field_name: 'supplier_name',
          value: normalizedExtraction.supplier_name || '',
          confidence: confidence.fields.supplier_name || confidence.overall,
        },
        {
          field_name: 'invoice_date',
          value: normalizedExtraction.invoice_date || '',
          confidence: confidence.fields.invoice_date || confidence.overall,
        },
        {
          field_name: 'due_date',
          value: normalizedExtraction.due_date || '',
          confidence: confidence.fields.due_date || confidence.overall,
        },
      ];

      for (const field of fieldsToSave) {
        if (field.value) {
          const extraction = this.fieldExtractionsRepository.create({
            document_id: document.id,
            ...field,
            source: 'llm',
            snippet: '',
          });
          await this.fieldExtractionsRepository.save(extraction);
        }
      }

      // Update document status
      document.status = newStatus;
      document.processed_at = new Date();
      await this.documentsRepository.save(document);

      this.logger.log(`Invoice data saved - Status: ${newStatus}`);
    } catch (error) {
      this.logger.error(`Invoice extraction failed: ${error instanceof Error ? error.message : String(error)}`);

      // Mark document as needing validation on error
      document.status = DocumentStatus.NEEDS_VALIDATION;
      document.processed_at = new Date();
      await this.documentsRepository.save(document);

      throw error;
    }
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.debug(`Processing job ${job.id} of type ${job.name}`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`Completed job ${job.id} of type ${job.name}`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(
      `Failed job ${job.id} of type ${job.name}: ${error.message}`,
      error.stack,
    );
  }
}
