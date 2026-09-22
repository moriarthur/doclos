import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bull';
import { Job as BullJob, Queue } from 'bull';
import { Document, DocumentStatus } from './entities/document.entity';

/**
 * Boot-time recovery for documents stuck in `processing`.
 *
 * If the queue dies between upload and processing (deleted cloud Redis
 * instance, backend killed mid-flight), the Bull job is lost and the document
 * sits in `processing` forever — the UI shows an eternal spinner and the only
 * escape was a manual reprocess. Discovered 2026-09-22: the deleted Upstash
 * instance left 2026-09-21 uploads unprocessed, because the failed
 * `queue.add` was swallowed in uploadDocument.
 */
@Injectable()
export class DocumentsRecoveryService implements OnApplicationBootstrap {
  /** Processing docs older than this are considered orphaned (no live job). */
  private static readonly STALE_AFTER_MS = 30 * 60 * 1000;
  /** Upper bound per sweep — a fresh boot requeues what it can, not a storm. */
  private static readonly MAX_SWEEP = 50;

  private readonly logger = new Logger(DocumentsRecoveryService.name);

  constructor(
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    @InjectQueue('documents') private readonly documentsQueue: Queue,
  ) {}

  onApplicationBootstrap(): Promise<void> {
    return this.requeueStaleProcessingDocuments();
  }

  async requeueStaleProcessingDocuments(): Promise<void> {
    const cutoff = new Date(Date.now() - DocumentsRecoveryService.STALE_AFTER_MS);
    const staleDocs = await this.documentsRepository.find({
      where: { status: DocumentStatus.PROCESSING, updated_at: LessThan(cutoff) },
      take: DocumentsRecoveryService.MAX_SWEEP,
    });
    if (staleDocs.length === 0) return;

    this.logger.warn(
      `Recovery sweep: ${staleDocs.length} document(s) stuck in processing >30 min — requeueing`,
    );

    // Docs whose Bull job still exists (waiting/active/delayed) are left alone
    // — only true orphans are re-enqueued.
    const queuedJobs = await this.documentsQueue.getJobs(
      ['waiting', 'active', 'delayed', 'paused'],
      0,
      -1,
    );

    for (const doc of staleDocs) {
      const hasLiveJob = queuedJobs.some((j: BullJob) => j.data?.documentId === doc.id);
      if (hasLiveJob) continue;
      try {
        await this.documentsQueue.add('process-document', {
          documentId: doc.id,
          userId: doc.user_id,
        });
        this.logger.log(`Requeued orphaned document ${doc.id} (${doc.original_filename})`);
      } catch (err) {
        // Queue is down at boot: mark the document so the user sees a real
        // state instead of an eternal spinner; the next boot retries again.
        doc.status = DocumentStatus.ERROR;
        await this.documentsRepository.save(doc);
        this.logger.error(
          `Recovery: could not requeue document ${doc.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
