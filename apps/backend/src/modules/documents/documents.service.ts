import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import * as crypto from 'crypto';
import { Document, DocumentStatus, DocumentType } from './entities/document.entity';
import { Invoice } from './entities/invoice.entity';
import { FieldExtraction } from './entities/field-extraction.entity';
import { AuditLog } from '../jobs/entities/audit-log.entity';
import { Job } from '../jobs/entities/job.entity';
import { S3Service } from '../storage/services/s3.service';

// Part 3: AI Pipeline - Document processing workflow
// Part 4: API Specification - Document upload and processing
// Part 8: Infrastructure & Deployment - S3 storage

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document)
    private documentsRepository: Repository<Document>,
    @InjectRepository(Invoice)
    private invoicesRepository: Repository<Invoice>,
    @InjectRepository(FieldExtraction)
    private fieldExtractionsRepository: Repository<FieldExtraction>,
    @InjectRepository(AuditLog)
    private auditLogsRepository: Repository<AuditLog>,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectQueue('documents') private documentsQueue: Queue,
    private s3Service: S3Service,
  ) {}

  async uploadDocument(
    file: Express.Multer.File,
    userId: string,
    metadata?: { type?: DocumentType },
  ) {
    // Validate file size (10MB max)
    const maxSize = parseInt(process.env.MAX_FILE_SIZE || '10485760', 10);
    if (file.size > maxSize) {
      throw new BadRequestException('File too large');
    }

    // Validate file type
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'application/pdf,image/png,image/jpeg,image/tiff').split(',');
    if (!allowedTypes.includes(file.mimetype)) {
      throw new BadRequestException('Invalid file type');
    }

    // Generate S3 key
    const date = new Date();
    const s3Key = `uploads/${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}/${crypto.randomUUID()}-${file.originalname}`;

    // Upload to S3
    await this.s3Service.uploadFile(s3Key, file.buffer, file.mimetype);

    // Create document record
    const document = this.documentsRepository.create({
      user_id: userId,
      type: metadata?.type || DocumentType.UNKNOWN,
      status: DocumentStatus.UPLOADED,
      original_filename: file.originalname,
      s3_key: s3Key,
      mime_type: file.mimetype,
      file_size: file.size,
      page_count: undefined, // Will be determined during processing
    });
    await this.documentsRepository.save(document);

    // Set status to processing immediately for responsive UI
    document.status = DocumentStatus.PROCESSING;
    await this.documentsRepository.save(document);

    // Add to processing queue (worker will handle the rest)
    this.documentsQueue.add('process-document', {
      documentId: document.id,
      userId,
    }).catch((err) => {
      this.logger.error(`Failed to queue document ${document.id}: ${err.message}`);
    });

    return {
      document_id: document.id,
      status: document.status,
    };
  }

  async listDocuments(
    userId: string,
    query: { page?: number; limit?: number; status?: DocumentStatus; company?: string; from_date?: Date; to_date?: Date },
  ) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 20, 100);
    const skip = (page - 1) * limit;

    const qb = this.documentsRepository
      .createQueryBuilder('document')
      .leftJoinAndSelect('document.customer', 'customer')
      .leftJoinAndSelect('document.invoice', 'invoice')
      .where('document.user_id = :userId', { userId });

    if (query.status) {
      qb.andWhere('document.status = :status', { status: query.status });
    }

    if (query.company) {
      qb.andWhere('customer.name ILIKE :company', { company: `%${query.company}%` });
    }

    if (query.from_date) {
      qb.andWhere('document.created_at >= :fromDate', { fromDate: query.from_date });
    }

    if (query.to_date) {
      qb.andWhere('document.created_at <= :toDate', { toDate: query.to_date });
    }

    const [documents, total] = await qb
      .orderBy('document.created_at', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    return {
      data: documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        status: doc.status,
        company_name: doc.invoice?.supplier_name || doc.customer?.name,
        amount: doc.invoice?.amount_total,
        currency: doc.invoice?.currency,
        invoice_date: doc.invoice?.invoice_date,
        created_at: doc.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
      },
    };
  }

  async getDocument(documentId: string, userId: string) {
    try {
      this.logger.log(`[getDocument] Fetching document ${documentId} for user ${userId}`);

      // Use query builder for more control
      const document = await this.documentsRepository
        .createQueryBuilder('document')
        .leftJoinAndSelect('document.customer', 'customer')
        .leftJoinAndSelect('document.invoice', 'invoice')
        .where('document.id = :documentId', { documentId })
        .andWhere('document.user_id = :userId', { userId })
        .getOne();

      this.logger.log(`[getDocument] Document found: ${!!document}`);
      if (document) {
        this.logger.log(`[getDocument] Document.invoiceId: ${document.invoiceId}`);
        this.logger.log(`[getDocument] Document.invoice: ${!!document.invoice}`);
        this.logger.log(`[getDocument] Document.customer: ${!!document.customer}`);
      } else {
        this.logger.warn(`[getDocument] Document NOT FOUND - checking if document exists at all`);
        const docWithoutUser = await this.documentsRepository.findOne({
          where: { id: documentId },
        });
        this.logger.log(`[getDocument] Document exists (ignoring user): ${!!docWithoutUser}`);
        if (docWithoutUser) {
          this.logger.log(`[getDocument] Document user_id: ${docWithoutUser.user_id}`);
          this.logger.log(`[getDocument] Requested user_id: ${userId}`);
        }
        throw new NotFoundException('Document not found');
      }

    // Get signed URL from S3 (Part 7: Security & GDPR - Signed URLs expire after 24h)
    const fileUrl = await this.s3Service.getSignedUrl(document.s3_key);

    // Get field extractions for confidence info
    const extractions = await this.fieldExtractionsRepository.find({
      where: { document_id: documentId },
    });

    const extractionMap = extractions.reduce((acc, ext) => {
      acc[ext.field_name] = { value: ext.value, confidence: ext.confidence };
      return acc;
    }, {} as Record<string, { value: string; confidence: number }>);

    return {
      id: document.id,
      status: document.status,
      file_url: fileUrl,
      mime_type: document.mime_type,
      original_filename: document.original_filename,
      invoice: document.invoice
        ? {
            invoice_number: document.invoice.invoice_number
              ? { value: document.invoice.invoice_number, confidence: extractionMap['invoice_number']?.confidence }
              : extractionMap['invoice_number'],
            amount_total: document.invoice.amount_total != null
              ? { value: String(document.invoice.amount_total), confidence: extractionMap['amount_total']?.confidence }
              : extractionMap['amount_total'],
            currency: document.invoice.currency,
            invoice_date: document.invoice.invoice_date
              ? typeof document.invoice.invoice_date === 'string'
                  ? document.invoice.invoice_date
                  : new Date(document.invoice.invoice_date).toISOString().split('T')[0]
              : undefined,
            due_date: document.invoice.due_date
              ? typeof document.invoice.due_date === 'string'
                  ? document.invoice.due_date
                  : new Date(document.invoice.due_date).toISOString().split('T')[0]
              : undefined,
            supplier_name: document.invoice.supplier_name
              ? { value: document.invoice.supplier_name, confidence: extractionMap['supplier_name']?.confidence }
              : extractionMap['supplier_name'],
            supplier_address: document.invoice.supplier_address
              ? { value: document.invoice.supplier_address, confidence: extractionMap['supplier_address']?.confidence }
              : extractionMap['supplier_address'],
          }
        : undefined,
    };
    } catch (error) {
      this.logger.error(`[getDocument] ERROR: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        this.logger.error(`[getDocument] Stack: ${error.stack}`);
      }
      throw error;
    }
  }

  async validateDocument(documentId: string, userId: string, fields: Record<string, unknown>) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
      relations: ['invoice'],
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Store old values for audit log
    const oldValues: Record<string, unknown> = {};
    if (document.invoice) {
      oldValues.invoice_number = document.invoice.invoice_number;
      oldValues.amount_total = document.invoice.amount_total;
      oldValues.invoice_date = document.invoice.invoice_date;
    }

    // Update invoice with new values
    if (document.invoice) {
      if (fields.invoice_number) document.invoice.invoice_number = String(fields.invoice_number);
      if (fields.amount_total) {
        const num = Number(fields.amount_total);
        if (isNaN(num) || num === 0) {
          throw new BadRequestException('Betrag muss eine Zahl ungleich 0 sein');
        }
        document.invoice.amount_total = num;
      }
      if (fields.invoice_date) {
        const dateStr = String(fields.invoice_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          throw new BadRequestException('Ungültiges Datumsformat (JJJJ-MM-TT)');
        }
        document.invoice.invoice_date = new Date(dateStr);
      }
      if (fields.due_date) {
        const dateStr = String(fields.due_date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          throw new BadRequestException('Ungültiges Datumsformat (JJJJ-MM-TT)');
        }
        document.invoice.due_date = new Date(dateStr);
      }
      if (fields.currency) {
        document.invoice.currency = String(fields.currency);
      }
      if (fields.supplier_name) {
        document.invoice.supplier_name = String(fields.supplier_name);
      }
      if (fields.supplier_address) {
        document.invoice.supplier_address = String(fields.supplier_address);
      }
      document.invoice.validated = true;
      await this.invoicesRepository.save(document.invoice);
    }

    // Update document status
    document.status = DocumentStatus.VALIDATED;
    document.processed_at = new Date();
    await this.documentsRepository.save(document);

    // Write audit log (Part 7: Security & GDPR)
    await this.auditLogsRepository.save({
      entity_type: 'document',
      entity_id: documentId,
      user_id: userId,
      action: 'validate',
      old_value: oldValues,
      new_value: fields,
    });

    return { status: document.status };
  }

  async reprocessDocument(documentId: string, userId: string) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Reset status
    document.status = DocumentStatus.PROCESSING;
    await this.documentsRepository.save(document);

    // Add to processing queue
    await this.documentsQueue.add('reprocess-document', {
      documentId,
      userId,
    });

    return { status: document.status };
  }

  async getDocumentFile(documentId: string, userId: string) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const buffer = await this.s3Service.downloadFile(document.s3_key);
    return { buffer, mimeType: document.mime_type, filename: document.original_filename };
  }

  async updateDocumentStatus(documentId: string, userId: string, status: string) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    const oldStatus = document.status;

    // Handle special "unarchive" status value
    if (status === 'unarchive') {
      if (oldStatus !== DocumentStatus.ARCHIVED) {
        throw new BadRequestException('Document is not archived');
      }
      // Restore previous status
      document.status = document.previous_status || DocumentStatus.PARSED;
      document.previous_status = null;
    }
    // Handle archiving: save current status before changing
    else if (status === DocumentStatus.ARCHIVED && oldStatus !== DocumentStatus.ARCHIVED) {
      document.previous_status = oldStatus;
      document.status = DocumentStatus.ARCHIVED;
    }
    // Handle normal status change (but don't allow changing from archived directly)
    else if (oldStatus === DocumentStatus.ARCHIVED) {
      throw new BadRequestException('Cannot change status directly from archived. Use unarchive first.');
    }
    // Validate status for normal changes
    else {
      const validStatuses = Object.values(DocumentStatus);
      if (!validStatuses.includes(status as DocumentStatus)) {
        throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }
      document.status = status as DocumentStatus;
    }

    await this.documentsRepository.save(document);

    // Write audit log
    await this.auditLogsRepository.save({
      entity_type: 'document',
      entity_id: documentId,
      user_id: userId,
      action: 'status_update',
      old_value: { status: oldStatus },
      new_value: { status: document.status },
    });

    return { status: document.status };
  }

  async deleteDocument(documentId: string, userId: string) {
    const document = await this.documentsRepository.findOne({
      where: { id: documentId, user_id: userId },
      relations: ['invoice'],
    });

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    // Delete file from S3
    try {
      await this.s3Service.deleteFile(document.s3_key);
      this.logger.log(`Deleted file from S3: ${document.s3_key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file from S3: ${document.s3_key}`, error);
      // Continue with database deletion even if S3 deletion fails
    }

    // Delete related jobs first (foreign key constraint)
    const jobs = await this.jobsRepository.find({
      where: { document_id: documentId },
    });
    if (jobs.length > 0) {
      await this.jobsRepository.remove(jobs);
      this.logger.log(`Deleted ${jobs.length} related jobs`);
    }

    // Delete related records (invoice, field extractions) will be handled by CASCADE
    await this.documentsRepository.remove(document);

    // Write audit log
    await this.auditLogsRepository.save({
      entity_type: 'document',
      entity_id: documentId,
      user_id: userId,
      action: 'delete',
      old_value: {
        filename: document.original_filename,
        status: document.status,
      },
      new_value: undefined,
    });
  }
}
