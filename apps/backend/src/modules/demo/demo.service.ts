import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DocumentsService } from '../documents/documents.service';
import { QuotaService } from '../../common/quota/quota.service';
import { Document } from '../documents/entities/document.entity';
import { buildSampleInvoicePdf } from './synthetic-invoice';

// PD-D1 (public-demo audit): the per-user synthetic sample flow. Every
// registered user can load ONE fictional invoice per day into their OWN
// tenant — it runs the exact same pipeline as a real upload (magic-byte
// checks, per-user quotas, storage keys, queue, GLM extraction), bypassing
// nothing. No shared account exists anywhere.

/** Stable marker for "this document is the synthetic sample" (reset flow). */
export const DEMO_SAMPLE_FILENAME = 'doclos-demo-sample.pdf';

@Injectable()
export class DemoService {
  private readonly logger = new Logger(DemoService.name);

  constructor(
    private readonly documentsService: DocumentsService,
    private readonly quotaService: QuotaService,
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
  ) {}

  /** Queue the synthetic sample through the real pipeline for this user. */
  async createSample(userId: string): Promise<{ document_id: string; status: string }> {
    // 1/day/user (PD-R2). The upload's own quotas (hour/day/storage/active
    // job) still apply inside uploadDocument — a sample IS a document.
    await this.quotaService.assertCanCreateSample(userId);

    const pdf = buildSampleInvoicePdf();
    const file = {
      fieldname: 'file',
      originalname: DEMO_SAMPLE_FILENAME,
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: pdf.length,
      buffer: pdf,
    } as Express.Multer.File;

    const result = await this.documentsService.uploadDocument(file, userId);
    this.logger.log(`Synthetic sample queued for user ${userId}: ${result.document_id}`);
    return result;
  }

  /** Reset: deletes ONLY this user's synthetic sample documents. */
  async resetSample(userId: string): Promise<{ deleted: number }> {
    const samples = await this.documentsRepository.find({
      where: { user_id: userId, original_filename: DEMO_SAMPLE_FILENAME },
      select: ['id'],
    });

    let deleted = 0;
    for (const sample of samples) {
      try {
        await this.documentsService.deleteDocument(sample.id, userId);
        deleted++;
      } catch (err) {
        // Not found → already gone; anything else surfaces to the caller.
        if ((err as { status?: number }).status !== 404) throw err;
      }
    }
    return { deleted };
  }

  /** Report whether the user currently has a sample (UI hint). */
  async hasSample(userId: string): Promise<boolean> {
    const count = await this.documentsRepository.count({
      where: { user_id: userId, original_filename: DEMO_SAMPLE_FILENAME },
    });
    return count > 0;
  }
}
