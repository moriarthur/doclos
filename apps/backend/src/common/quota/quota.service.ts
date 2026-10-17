import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { Document, DocumentStatus } from '../../modules/documents/entities/document.entity';
import { redisConnectionOptions } from '../../config/redis-options';
import { QuotaExceededException } from './quota.exceptions';

// PD-R2 (public-demo audit): IP throttling alone doesn't bound a registered
// user — rotate IPs and the GLM/R2/Redis budget is unbounded. Every limit
// below is per-user (or per-document) and enforced server-side.
//
// Two mechanisms:
// - Redis fixed-window counters (docs/hour, docs/day, reprocess/day/doc,
//   sample/day): cheap, self-expiring. A failed upload that already counted
//   burns its slot — deliberate (fail-closed): error-retry loops must not
//   become free retries.
// - DB checks (total stored bytes, active processing job): self-healing
//   ground truth, no INCR/DECR drift.
//
// Like the rate limiter, Redis-based checks fail OPEN on a Redis outage (the
// demo stays usable); the DB-based checks keep enforcing. Limits are tuned in
// code on purpose — the deployment contract stays free of abuse knobs.
export const QUOTA_LIMITS = {
  /** New documents per hour per user. */
  DOCUMENTS_PER_HOUR: 3,
  /** New documents per day per user. */
  DOCUMENTS_PER_DAY: 10,
  /** Stored bytes per user (uploads rejected beyond this). */
  MAX_TOTAL_STORAGE_BYTES: 100 * 1024 * 1024,
  /** Concurrently processing documents per user (queue is serial per user). */
  MAX_ACTIVE_JOBS: 1,
  /** Reprocesses per document per day. */
  REPROCESSES_PER_DOCUMENT_PER_DAY: 2,
  /** Synthetic samples per day per user. */
  SAMPLES_PER_DAY: 1,
} as const;

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

@Injectable()
export class QuotaService implements OnApplicationShutdown {
  private readonly logger = new Logger(QuotaService.name);
  private readonly redis: Redis;

  constructor(
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
  ) {
    this.redis = new Redis({ ...redisConnectionOptions(), lazyConnect: false });
    this.redis.on('error', () => {
      /* logged per-operation in failOpenIncr; keep the process quiet */
    });
  }

  /** Fixed-window counter; returns the new hit count. Fails open with 0. */
  private async incrWindow(key: string, windowMs: number): Promise<number> {
    try {
      const hits = await this.redis.incr(key);
      if (hits === 1) await this.redis.pexpire(key, windowMs);
      return hits;
    } catch (err) {
      this.logger.error(`Quota counter unavailable (failing open): ${(err as Error).message}`);
      return 0;
    }
  }

  /** Remaining ms of the fixed window that started at `startMs`. */
  private retryAfterSeconds(windowMs: number): number {
    return Math.max(1, Math.ceil(windowMs / 1000));
  }

  /**
   * Storage + hourly + daily admission in one call. Throws 429 when over.
   * Call BEFORE any S3/DB write — a counted-but-failed attempt burns its
   * window slot on purpose (error-retry loops must not become free retries).
   */
  async assertUploadQuota(userId: string, fileSize: number): Promise<void> {
    // Stored bytes: DB ground truth (deleted rows release budget immediately).
    const [{ used }] = await this.documentsRepository
      .createQueryBuilder('document')
      .select('COALESCE(SUM(document.file_size), 0)', 'used')
      .where('document.user_id = :userId', { userId })
      .getRawMany();
    if (Number(used) + fileSize > QUOTA_LIMITS.MAX_TOTAL_STORAGE_BYTES) {
      throw new QuotaExceededException(
        'Storage quota reached (100 MB per account) — delete documents to free space',
        this.retryAfterSeconds(DAY_MS),
      );
    }

    // Active processing job: DB ground truth (worker/completion clears it).
    const activeJobs = await this.documentsRepository.count({
      where: { user_id: userId, status: DocumentStatus.PROCESSING },
    });
    if (activeJobs >= QUOTA_LIMITS.MAX_ACTIVE_JOBS) {
      throw new QuotaExceededException(
        'A document is already being processed — wait for it to finish',
        60,
      );
    }

    const hourKey = `quota:docs-hour:${userId}:${Math.floor(Date.now() / HOUR_MS)}`;
    const hourHits = await this.incrWindow(hourKey, HOUR_MS);
    if (hourHits > QUOTA_LIMITS.DOCUMENTS_PER_HOUR) {
      throw new QuotaExceededException(
        `Upload limit reached (${QUOTA_LIMITS.DOCUMENTS_PER_HOUR} documents per hour)`,
        this.retryAfterSeconds(HOUR_MS),
      );
    }

    const dayKey = `quota:docs-day:${userId}:${Math.floor(Date.now() / DAY_MS)}`;
    const dayHits = await this.incrWindow(dayKey, DAY_MS);
    if (dayHits > QUOTA_LIMITS.DOCUMENTS_PER_DAY) {
      throw new QuotaExceededException(
        `Upload limit reached (${QUOTA_LIMITS.DOCUMENTS_PER_DAY} documents per day)`,
        this.retryAfterSeconds(DAY_MS),
      );
    }
  }

  /** Reprocess admission: 2/day/document. Throws 429 when over. */
  async assertCanReprocess(documentId: string): Promise<void> {
    const key = `quota:reprocess:${documentId}:${Math.floor(Date.now() / DAY_MS)}`;
    const hits = await this.incrWindow(key, DAY_MS);
    if (hits > QUOTA_LIMITS.REPROCESSES_PER_DOCUMENT_PER_DAY) {
      throw new QuotaExceededException(
        `Reprocess limit reached (${QUOTA_LIMITS.REPROCESSES_PER_DOCUMENT_PER_DAY} per day for this document)`,
        this.retryAfterSeconds(DAY_MS),
      );
    }
  }

  /** Sample admission: 1/day/user. Throws 429 when over. Returns nothing. */
  async assertCanCreateSample(userId: string): Promise<void> {
    const key = `quota:sample:${userId}:${Math.floor(Date.now() / DAY_MS)}`;
    const hits = await this.incrWindow(key, DAY_MS);
    if (hits > QUOTA_LIMITS.SAMPLES_PER_DAY) {
      throw new QuotaExceededException(
        'Sample limit reached (1 per day) — the sample already processed today is available in your documents',
        this.retryAfterSeconds(DAY_MS),
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
