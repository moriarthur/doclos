import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PendingStorageDeletion } from '../entities/pending-storage-deletion.entity';
import { S3Service } from './s3.service';

// PD-T1 (public-demo audit): the sweeper half of account deletion — rows in
// pending_storage_deletions are storage objects that still exist in R2 after
// their owner was erased. Purged at boot and hourly; each attempt increments
// the attempts counter, successes remove the row. The backlog is always
// visible as table rows (SQL: SELECT count(*) FROM pending_storage_deletions).
@Injectable()
export class StorageCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  /** Upper bound per sweep — catch up gradually, never a delete storm. */
  private static readonly BATCH = 100;
  private static readonly INTERVAL_MS = 60 * 60 * 1000;

  private readonly logger = new Logger(StorageCleanupService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(PendingStorageDeletion)
    private readonly pendingRepository: Repository<PendingStorageDeletion>,
    private readonly s3Service: S3Service,
  ) {}

  onApplicationBootstrap(): void {
    void this.purgeQueued();
    this.timer = setInterval(() => void this.purgeQueued(), StorageCleanupService.INTERVAL_MS);
    this.timer.unref(); // never hold the process open for cleanup
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Attempt up to `limit` queued deletions. Returns how many objects were
   * removed from R2.
   */
  async purgeQueued(limit: number = StorageCleanupService.BATCH): Promise<number> {
    const backlog = await this.pendingRepository.find({ take: limit, order: { created_at: 'ASC' } });
    let purged = 0;
    for (const row of backlog) {
      try {
        await this.s3Service.deleteFile(row.s3_key);
        await this.pendingRepository.delete({ id: row.id });
        purged++;
      } catch (err) {
        // Keep the row — retried next sweep (observable + retryable).
        row.attempts += 1;
        await this.pendingRepository.save(row);
        this.logger.error(
          `Storage cleanup deferred (attempt ${row.attempts}) for ${row.s3_key}: ${(err as Error).message}`,
        );
      }
    }
    return purged;
  }
}
