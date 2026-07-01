import { Process, Processor, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { Job } from 'bull';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Document, DocumentStatus, DocumentType } from '../entities/document.entity';
import type { LocalizedIssue } from '../entities/document.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { FieldExtraction } from '../entities/field-extraction.entity';
import { Job as JobEntity, JobStatus } from '../../jobs/entities/job.entity';
import { S3Service } from '../../storage/services/s3.service';
import { OcrService } from '../../ocr/services/ocr.service';
import { DocumentClassifierService } from '../../ai/services/document-classifier.service';
import { StructuredExtractionService, sanitizeMetadata } from '../../ai/services/structured-extraction.service';

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

  /**
   * Heuristic: does this document's text indicate a EUR (German/EU) invoice?
   *
   * Invoices in the target market (Germany/EU) often state the amount without an
   * explicit currency next to the total, yet are unambiguously EUR. The extraction
   * prompt returns currency=null in that case, which would otherwise force a
   * high-confidence invoice into needs_validation. Default to EUR when strong
   * German/EU indicators are present; leave null (→ validation) only when nothing
   * points to EUR.
   */
  private looksLikeEurInvoice(text: string): boolean {
    const t = text.toLowerCase();
    // Explicit €/EUR, or German accounting vocabulary that in practice always
    // accompanies a EUR invoice (CHF invoices virtually always state CHF).
    return /(€|\beur\b|mwst|umsatzsteuer|\bust\b|rechnung)/.test(t);
  }

  @Process({ name: 'process-document', concurrency: 1 })
  async handleProcessDocument(job: Job<ProcessDocumentJob>) {
    const { documentId, userId } = job.data;

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

      // Defense-in-depth: only the owner may trigger processing of their document.
      // (Ownership is already enforced at the HTTP enqueue layer; this guards the
      // trusted worker against any path that bypasses it.)
      if (document.user_id !== userId) {
        throw new Error(
          `Unauthorized: document ${documentId} does not belong to user ${userId}`,
        );
      }

      // Update status to processing
      document.status = DocumentStatus.PROCESSING;
      // Clear any diagnostics from a previous run so stale confidence/issues
      // never survive a reprocess. Metadata is reset too: re-classification may
      // land on a different document type, and the new type's metadata is a
      // different shape — never leave the previous type's metadata behind.
      document.extraction_confidence = null;
      document.extraction_issues = null;
      document.metadata = null;
      await this.documentsRepository.save(document);

      // Clean up artifacts from a previous run so reprocessing never leaves
      // duplicate invoices or accumulating field extractions behind (Bug A).
      await this.fieldExtractionsRepository.delete({ document_id: documentId });
      if (document.invoiceId) {
        const oldInvoiceId = document.invoiceId;
        // Clear the document's FK reference first (documents.invoiceId → invoices.id),
        // otherwise deleting the invoice violates the foreign-key constraint.
        document.invoiceId = null as any;
        await this.documentsRepository.save(document);
        await this.invoiceItemsRepository.delete({ invoice_id: oldInvoiceId });
        await this.invoicesRepository.delete({ id: oldInvoiceId });
      }

      // 1. Download file from S3
      this.logger.log(`Downloading file from S3: ${document.s3_key}`);
      jobRecord.progress = { stage: 'downloading', message: 'Downloading file...' };
      await this.jobsRepository.save(jobRecord);
      job.progress(10);
      const fileBuffer = await this.s3Service.downloadFile(document.s3_key);

      if (await isCancelled()) {
        this.logger.log(`Job cancelled after download: ${documentId}`);
        return;
      }

      // 2. Extract text / OCR
      this.logger.log('Starting OCR processing');
      jobRecord.progress = { stage: 'ocr', message: 'Starting OCR...', current: 0, total: 0 };
      await this.jobsRepository.save(jobRecord);
      job.progress(25);
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
      job.progress(50);
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

      // 4. Extract structured data with LLM, dispatched by document type.
      // Invoices, purchase orders, offers and delivery notes are all tabular
      // commercial documents and share the Invoice + invoice_items carrier +
      // customer path; contracts are non-tabular (parties/dates only, no items);
      // unknown documents stay parsed-only.
      job.progress(65);
      switch (classification.type) {
        case DocumentType.INVOICE:
        case DocumentType.PURCHASE_ORDER:
        case DocumentType.OFFER:
        case DocumentType.DELIVERY_NOTE: {
          // Rate limit buffer: wait before the GLM extraction call.
          await new Promise((r) => setTimeout(r, 3000));
          await this.extractCommercialDocument(document, ocrResult.text, classification.type);
          break;
        }
        case DocumentType.CONTRACT: {
          await new Promise((r) => setTimeout(r, 3000));
          await this.extractContractDocument(document, ocrResult.text);
          break;
        }
        default: {
          // UNKNOWN: no extraction — mark as parsed.
          document.status = DocumentStatus.PARSED;
          document.processed_at = new Date();
          document.extraction_confidence = null;
          document.extraction_issues = null;
          document.metadata = null;
          await this.documentsRepository.save(document);
          break;
        }
      }

      // Update job status
      jobRecord.status = JobStatus.COMPLETED;
      job.progress(100);
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
   * Type-dispatched extraction + normalization for tabular commercial documents
   * (invoice / purchase order / offer / delivery note). Every normalized shape is
   * a record of the same field-coercion rules (ISO dates, numeric money,
   * upper-cased currency, cleaned line items), so a single Record view is enough
   * for the carrier mapping and the type-aware guard.
   * Part 3: AI Pipeline - Structured data extraction
   */
  private async extractNormalizedCommercial(extractedText: string, type: DocumentType): Promise<{
    n: Record<string, unknown>;
    confidence: { overall: number; fields: Record<string, number>; issues: LocalizedIssue[] };
    cost: number;
  }> {
    switch (type) {
      case DocumentType.INVOICE: {
        const r = await this.structuredExtractionService.extractInvoiceData(extractedText);
        return {
          n: this.structuredExtractionService.normalizeExtraction(r.data) as unknown as Record<string, unknown>,
          confidence: r.confidence,
          cost: r.cost,
        };
      }
      case DocumentType.PURCHASE_ORDER: {
        const r = await this.structuredExtractionService.extractPurchaseOrderData(extractedText);
        return {
          n: this.structuredExtractionService.normalizePurchaseOrder(r.data) as unknown as Record<string, unknown>,
          confidence: r.confidence,
          cost: r.cost,
        };
      }
      case DocumentType.OFFER: {
        const r = await this.structuredExtractionService.extractOfferData(extractedText);
        return {
          n: this.structuredExtractionService.normalizeOffer(r.data) as unknown as Record<string, unknown>,
          confidence: r.confidence,
          cost: r.cost,
        };
      }
      case DocumentType.DELIVERY_NOTE: {
        const r = await this.structuredExtractionService.extractDeliveryNoteData(extractedText);
        return {
          n: this.structuredExtractionService.normalizeDeliveryNote(r.data) as unknown as Record<string, unknown>,
          confidence: r.confidence,
          cost: r.cost,
        };
      }
      default:
        // Unreachable: the caller's switch only enters here for the four types above.
        throw new Error(`Unsupported commercial document type: ${type}`);
    }
  }

  /**
   * Extract structured data for a tabular commercial document (invoice, purchase
   * order, offer, delivery note) and persist it. All four share the Invoice +
   * invoice_items carrier and the customer find-or-create path; per-type
   * differences (field names, the items price-rule, the correctness guard, the
   * type-specific metadata) are dispatched on `type`. The invoice branch is
   * behaviour-preserving versus the previous invoice-only path — same fields,
   * same guard conditions and messages, same status logic, metadata stays null.
   */
  private async extractCommercialDocument(
    document: Document,
    extractedText: string,
    type: DocumentType,
  ) {
    try {
      this.logger.log(`Extracting ${type} data with LLM`);

      const { n, confidence, cost } = await this.extractNormalizedCommercial(extractedText, type);

      this.logger.log(
        `Extraction complete - Confidence: ${(confidence.overall * 100).toFixed(1)}% (cost: $${cost.toFixed(4)})`,
      );

      // Default currency to EUR for German/EU commercial documents that don't
      // state it explicitly (common in the target market). Genuinely ambiguous
      // docs (no €/EUR/Rechnung/MwSt/Bestellung indicators) still route to
      // validation via the correctness guard below.
      if (!n['currency'] && this.looksLikeEurInvoice(extractedText)) {
        this.logger.log('Currency not explicitly stated — defaulting to EUR (German/EU heuristic)');
        n['currency'] = 'EUR';
      }

      // Correctness guard (type-aware): never auto-accept an extraction that is
      // unusable for its type. Produces the bilingual severity 'missing' issues
      // that drive NEEDS_VALIDATION routing and the "please fill in" group in
      // the validation card. Invoice messages are byte-identical to the previous
      // inline guard.
      const guardReasons = this.structuredExtractionService.validateByType(type, n);
      const guardTriggered = guardReasons.length > 0;

      // Determine validation requirement based on confidence.
      const autoAcceptThreshold = 0.85;
      const needsValidationThreshold = 0.6;
      let newStatus: DocumentStatus;
      if (guardTriggered) {
        newStatus = DocumentStatus.NEEDS_VALIDATION;
        this.logger.log('Correctness guard triggered - critical fields missing/invalid, needs validation');
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

      // Map the per-type extraction onto the shared carrier.
      const carrier = this.buildCommercialCarrier(type, n);

      // Find or create customer (from supplier_name = the issuing party).
      let customer: Customer | null = null;
      if (carrier.supplierName) {
        const existingCustomer = await this.customersRepository.findOne({
          where: { name: carrier.supplierName },
        });
        if (existingCustomer) {
          customer = existingCustomer;
        } else {
          customer = this.customersRepository.create({
            name: carrier.supplierName,
            address: carrier.supplierAddress || undefined,
          });
          await this.customersRepository.save(customer);
        }
        document.customer_id = customer.id;
      }

      // Create the Invoice carrier row (holds the shared number/date/money for
      // every commercial type). invoice_items holds the line items. Non-invoice
      // types are filtered out of invoice-flavoured exports in S5.3.
      const invoice = new Invoice();
      invoice.document_id = document.id;
      invoice.invoice_number = carrier.number || '';
      invoice.invoice_date = carrier.date ? new Date(carrier.date) : (null as any);
      invoice.due_date = carrier.dueDate ? new Date(carrier.dueDate) : (null as any);
      invoice.amount_total = carrier.amountTotal ?? 0;
      invoice.vat_amount = carrier.vatAmount ?? 0;
      invoice.currency = carrier.currency || '';
      invoice.supplier_name = carrier.supplierName || '';
      invoice.supplier_address = carrier.supplierAddress || '';
      invoice.validated = confidence.overall >= autoAcceptThreshold && !guardTriggered;
      await this.invoicesRepository.save(invoice);

      // Link invoice to document
      document.invoiceId = invoice.id;

      // Create line items (shared invoice_items carrier).
      for (const item of carrier.items) {
        const invoiceItem = this.invoiceItemsRepository.create({
          invoice_id: invoice.id,
          description: item.description,
          quantity: item.quantity,
          unit_price: item.unit_price,
          line_total: item.line_total,
        });
        await this.invoiceItemsRepository.save(invoiceItem);
      }

      // Field extractions with confidence scores (type-specific field set).
      for (const field of carrier.fieldRows) {
        if (field.value) {
          const extraction = this.fieldExtractionsRepository.create({
            document_id: document.id,
            field_name: field.field_name,
            value: field.value,
            confidence: confidence.fields[field.confidenceField] ?? confidence.overall,
            source: 'llm',
            snippet: '',
          });
          await this.fieldExtractionsRepository.save(extraction);
        }
      }

      // Update document status + metadata (null for invoice).
      document.status = newStatus;
      document.processed_at = new Date();
      document.extraction_confidence = confidence.overall;
      document.extraction_issues = [...guardReasons, ...(confidence.issues ?? [])];
      document.metadata = sanitizeMetadata(carrier.metadata);
      await this.documentsRepository.save(document);

      this.logger.log(`${type} data saved - Status: ${newStatus}`);
    } catch (error) {
      this.logger.error(`${type} extraction failed: ${error instanceof Error ? error.message : String(error)}`);

      // Mark document as needing validation on error
      document.status = DocumentStatus.NEEDS_VALIDATION;
      document.processed_at = new Date();
      await this.documentsRepository.save(document);

      throw error;
    }
  }

  /**
   * Map a normalized per-type extraction onto the shared commercial carrier:
   * the carrier number/date/money that populate the Invoice row, the cleaned
   * items, the type-specific extras that go into documents.metadata (null for
   * invoices), and the field-extraction rows. Pure (no I/O) except for the EUR
   * log line — runs after the EUR heuristic has already mutated `n`.
   */
  private buildCommercialCarrier(
    type: DocumentType,
    n: Record<string, unknown>,
  ): {
    number: string | null;
    date: string | null;
    dueDate: string | null;
    amountTotal: number | null;
    vatAmount: number | null;
    currency: string | null;
    supplierName: string | null;
    supplierAddress: string | null;
    items: Array<{ description: string; quantity: number; unit_price: number; line_total: number }>;
    metadata: Record<string, unknown> | null;
    fieldRows: Array<{ field_name: string; value: string; confidenceField: string }>;
  } {
    const items = Array.isArray(n['items'])
      ? (n['items'] as Array<{
          description: string;
          quantity: number;
          unit_price: number;
          line_total: number;
        }>)
      : [];

    const carrier = {
      number: null as string | null,
      date: null as string | null,
      dueDate: null as string | null,
      amountTotal: null as number | null,
      vatAmount: null as number | null,
      currency: this.asString(n['currency']),
      supplierName: this.asString(n['supplier_name']),
      supplierAddress: this.asString(n['supplier_address']),
      items,
      metadata: null as Record<string, unknown> | null,
      fieldRows: [] as Array<{ field_name: string; value: string; confidenceField: string }>,
    };

    switch (type) {
      case DocumentType.INVOICE:
        carrier.number = this.asString(n['invoice_number']);
        carrier.date = this.asString(n['invoice_date']);
        carrier.dueDate = this.asString(n['due_date']);
        carrier.amountTotal = this.asNumber(n['amount_total']);
        carrier.vatAmount = this.asNumber(n['vat_amount']);
        carrier.metadata = null; // invoices live in the invoice entity, not metadata
        carrier.fieldRows = [
          { field_name: 'invoice_number', value: carrier.number ?? '', confidenceField: 'invoice_number' },
          { field_name: 'amount_total', value: carrier.amountTotal != null ? String(carrier.amountTotal) : '', confidenceField: 'amount_total' },
          { field_name: 'supplier_name', value: carrier.supplierName ?? '', confidenceField: 'supplier_name' },
          { field_name: 'invoice_date', value: carrier.date ?? '', confidenceField: 'invoice_date' },
          { field_name: 'due_date', value: carrier.dueDate ?? '', confidenceField: 'due_date' },
        ];
        break;
      case DocumentType.PURCHASE_ORDER: {
        carrier.number = this.asString(n['po_number']);
        carrier.date = this.asString(n['order_date']);
        carrier.amountTotal = this.asNumber(n['amount_total']);
        carrier.vatAmount = this.asNumber(n['vat_amount']);
        const expectedDelivery = this.asString(n['expected_delivery_date']);
        carrier.metadata = {
          customer_name: n['customer_name'] ?? null,
          expected_delivery_date: n['expected_delivery_date'] ?? null,
          delivery_terms: n['delivery_terms'] ?? null,
          payment_terms: n['payment_terms'] ?? null,
        };
        carrier.fieldRows = [
          { field_name: 'po_number', value: carrier.number ?? '', confidenceField: 'po_number' },
          { field_name: 'order_date', value: carrier.date ?? '', confidenceField: 'order_date' },
          { field_name: 'amount_total', value: carrier.amountTotal != null ? String(carrier.amountTotal) : '', confidenceField: 'amount_total' },
          { field_name: 'supplier_name', value: carrier.supplierName ?? '', confidenceField: 'supplier_name' },
          { field_name: 'expected_delivery_date', value: expectedDelivery ?? '', confidenceField: 'expected_delivery_date' },
        ];
        break;
      }
      case DocumentType.OFFER: {
        carrier.number = this.asString(n['offer_number']);
        carrier.date = this.asString(n['offer_date']);
        carrier.amountTotal = this.asNumber(n['amount_total']);
        carrier.vatAmount = this.asNumber(n['vat_amount']);
        const validity = this.asString(n['validity_date']);
        carrier.metadata = {
          customer_name: n['customer_name'] ?? null,
          validity_date: n['validity_date'] ?? null,
          validity_terms: n['validity_terms'] ?? null,
        };
        carrier.fieldRows = [
          { field_name: 'offer_number', value: carrier.number ?? '', confidenceField: 'offer_number' },
          { field_name: 'offer_date', value: carrier.date ?? '', confidenceField: 'offer_date' },
          { field_name: 'amount_total', value: carrier.amountTotal != null ? String(carrier.amountTotal) : '', confidenceField: 'amount_total' },
          { field_name: 'supplier_name', value: carrier.supplierName ?? '', confidenceField: 'supplier_name' },
          { field_name: 'validity_date', value: validity ?? '', confidenceField: 'validity_date' },
        ];
        break;
      }
      case DocumentType.DELIVERY_NOTE: {
        carrier.number = this.asString(n['delivery_note_number']);
        carrier.date = this.asString(n['delivery_date']);
        carrier.amountTotal = this.asNumber(n['amount_total']);
        carrier.vatAmount = this.asNumber(n['vat_amount']);
        const recipientName = this.asString(n['recipient_name']);
        const orderReference = this.asString(n['order_reference']);
        carrier.metadata = {
          delivery_note_number: n['delivery_note_number'] ?? null,
          delivery_date: n['delivery_date'] ?? null,
          recipient_name: n['recipient_name'] ?? null,
          recipient_address: n['recipient_address'] ?? null,
          order_reference: n['order_reference'] ?? null,
        };
        carrier.fieldRows = [
          { field_name: 'delivery_note_number', value: carrier.number ?? '', confidenceField: 'delivery_note_number' },
          { field_name: 'delivery_date', value: carrier.date ?? '', confidenceField: 'delivery_date' },
          { field_name: 'supplier_name', value: carrier.supplierName ?? '', confidenceField: 'supplier_name' },
          { field_name: 'recipient_name', value: recipientName ?? '', confidenceField: 'recipient_name' },
          { field_name: 'order_reference', value: orderReference ?? '', confidenceField: 'order_reference' },
        ];
        break;
      }
      default:
        break;
    }

    return carrier;
  }

  /**
   * Extract a contract (non-tabular: parties + dates + value, no items) and
   * persist it. Contracts carry NO Invoice/items carrier — everything
   * type-specific lives in documents.metadata; S5.2 UI / S5.3 export read it by
   * document.type='contract'. A customer is still created from the seller so
   * contracts are searchable by counterparty.
   */
  private async extractContractDocument(document: Document, extractedText: string) {
    try {
      this.logger.log('Extracting contract data with LLM');

      const { data: extraction, confidence, cost } =
        await this.structuredExtractionService.extractContractData(extractedText);
      const n = this.structuredExtractionService.normalizeContract(
        extraction,
      ) as unknown as Record<string, unknown>;

      this.logger.log(
        `Extraction complete - Confidence: ${(confidence.overall * 100).toFixed(1)}% (cost: $${cost.toFixed(4)})`,
      );

      // Correctness guard: a contract needs at least a party OR a date to be usable.
      const guardReasons = this.structuredExtractionService.validateByType(DocumentType.CONTRACT, n);
      const guardTriggered = guardReasons.length > 0;

      const autoAcceptThreshold = 0.85;
      const needsValidationThreshold = 0.6;
      let newStatus: DocumentStatus;
      if (guardTriggered) {
        newStatus = DocumentStatus.NEEDS_VALIDATION;
        this.logger.log('Correctness guard triggered - no party and no date, needs validation');
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

      // Find or create customer from the seller (the counterparty we track).
      const sellerName = this.asString(n['seller_name']);
      if (sellerName) {
        let customer = await this.customersRepository.findOne({ where: { name: sellerName } });
        if (!customer) {
          customer = this.customersRepository.create({ name: sellerName });
          await this.customersRepository.save(customer);
        }
        document.customer_id = customer.id;
      }

      // Everything contract-specific lives in metadata.
      const contractValue = n['contract_value'];
      const metadata: Record<string, unknown> = {
        seller_name: n['seller_name'] ?? null,
        buyer_name: n['buyer_name'] ?? null,
        effective_date: n['effective_date'] ?? null,
        end_date: n['end_date'] ?? null,
        contract_value: contractValue ?? null,
        currency: n['currency'] ?? null,
        subject: n['subject'] ?? null,
        term_description: n['term_description'] ?? null,
      };

      // Field extractions (contract field set).
      const fieldRows: Array<{ field_name: string; value: string }> = [
        { field_name: 'seller_name', value: this.asString(n['seller_name']) ?? '' },
        { field_name: 'buyer_name', value: this.asString(n['buyer_name']) ?? '' },
        { field_name: 'effective_date', value: this.asString(n['effective_date']) ?? '' },
        { field_name: 'end_date', value: this.asString(n['end_date']) ?? '' },
        { field_name: 'contract_value', value: contractValue != null ? String(contractValue) : '' },
        { field_name: 'subject', value: this.asString(n['subject']) ?? '' },
      ];
      for (const field of fieldRows) {
        if (field.value) {
          const fe = this.fieldExtractionsRepository.create({
            document_id: document.id,
            field_name: field.field_name,
            value: field.value,
            confidence: confidence.fields[field.field_name] ?? confidence.overall,
            source: 'llm',
            snippet: '',
          });
          await this.fieldExtractionsRepository.save(fe);
        }
      }

      document.status = newStatus;
      document.processed_at = new Date();
      document.extraction_confidence = confidence.overall;
      document.extraction_issues = [...guardReasons, ...(confidence.issues ?? [])];
      document.metadata = sanitizeMetadata(metadata);
      await this.documentsRepository.save(document);

      this.logger.log(`Contract data saved - Status: ${newStatus}`);
    } catch (error) {
      this.logger.error(`Contract extraction failed: ${error instanceof Error ? error.message : String(error)}`);

      // Mark document as needing validation on error
      document.status = DocumentStatus.NEEDS_VALIDATION;
      document.processed_at = new Date();
      await this.documentsRepository.save(document);

      throw error;
    }
  }

  /** Coerce an extraction value to a trimmed string, or null when absent/blank. */
  private asString(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = typeof v === 'string' ? v : String(v);
    const trimmed = s.trim();
    return trimmed === '' ? null : trimmed;
  }

  /** Coerce an extraction value to a number, or null when absent. */
  private asNumber(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    return typeof v === 'number' ? v : Number(v);
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
