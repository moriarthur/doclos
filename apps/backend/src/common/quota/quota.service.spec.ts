import { Repository } from 'typeorm';
import { QuotaService, QUOTA_LIMITS } from './quota.service';
import { Document } from '../../modules/documents/entities/document.entity';

// PD-R2: per-user quota admission. Redis is mocked; DB access is a stub
// repository with just the two calls the service makes (storage SUM, active
// PROCESSING count).
describe('QuotaService', () => {
  const HOUR_MS = 3_600_000;
  const DAY_MS = 24 * HOUR_MS;

  let redis: {
    incr: jest.Mock;
    pexpire: jest.Mock;
    quit: jest.Mock;
    on: jest.Mock;
  };
  let store: Map<string, number>;

  const makeRepo = (over: Partial<{ usedBytes: number; activeJobs: number }> = {}) => {
    const { usedBytes = 0, activeJobs = 0 } = over;
    return {
      createQueryBuilder: () => ({
        select: () => ({
          where: () => ({
            getRawMany: async () => [{ used: String(usedBytes) }],
          }),
        }),
      }),
      count: async () => activeJobs,
    } as unknown as Repository<Document>;
  };

  type Repo = ReturnType<typeof makeRepo>;

  const makeService = (repo: Repo) => {
    const service = Object.create(QuotaService.prototype) as QuotaService;
    Object.defineProperty(service, 'redis', { value: redis });
    Object.defineProperty(service, 'documentsRepository', { value: repo });
    Object.defineProperty(service, 'logger', { value: { error: jest.fn() } });
    return service;
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-15T10:00:00Z'));
    store = new Map();
    redis = {
      incr: jest.fn(async (key: string) => {
        store.set(key, (store.get(key) ?? 0) + 1);
        return store.get(key)!;
      }),
      pexpire: jest.fn(async () => 1),
      quit: jest.fn(async () => undefined),
      on: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('assertUploadQuota', () => {
    it('admits uploads under every limit', async () => {
      const service = makeService(makeRepo());
      await expect(service.assertUploadQuota('u1', 1024)).resolves.toBeUndefined();
    });

    it('rejects at DOCUMENTS_PER_HOUR and reports the hour window', async () => {
      const service = makeService(makeRepo());
      for (let i = 0; i < QUOTA_LIMITS.DOCUMENTS_PER_HOUR; i++) {
        await service.assertUploadQuota('u1', 1024);
      }
      await expect(service.assertUploadQuota('u1', 1024)).rejects.toMatchObject({
        response: { statusCode: 429, retryAfterSeconds: HOUR_MS / 1000 },
      } satisfies Record<string, unknown>);
    });

    it('hour window resets after an hour (expiry)', async () => {
      const service = makeService(makeRepo());
      for (let i = 0; i < QUOTA_LIMITS.DOCUMENTS_PER_HOUR; i++) {
        await service.assertUploadQuota('u1', 1024);
      }
      jest.setSystemTime(new Date('2026-10-15T11:00:00.001Z'));
      await expect(service.assertUploadQuota('u1', 1024)).resolves.toBeUndefined();
    });

    it('rejects at DOCUMENTS_PER_DAY even with the hour window clear', async () => {
      const service = makeService(makeRepo());
      // Consume the day window hour by hour so the hourly limit never fires.
      for (let i = 0; i < QUOTA_LIMITS.DOCUMENTS_PER_DAY; i++) {
        await service.assertUploadQuota('u1', 1024);
        jest.setSystemTime(new Date(Date.now() + HOUR_MS + 1_000));
      }
      await expect(service.assertUploadQuota('u1', 1024)).rejects.toMatchObject({
        response: { statusCode: 429, retryAfterSeconds: DAY_MS / 1000 },
      } satisfies Record<string, unknown>);
    });

    it('rejects when stored bytes would exceed the storage cap', async () => {
      const service = makeService(
        makeRepo({ usedBytes: QUOTA_LIMITS.MAX_TOTAL_STORAGE_BYTES - 500 }),
      );
      await expect(service.assertUploadQuota('u1', 1000)).rejects.toMatchObject({
        response: { statusCode: 429, message: expect.stringContaining('Storage quota') },
      } satisfies Record<string, unknown>);
    });

    it('rejects while another document of the same user is processing', async () => {
      const service = makeService(makeRepo({ activeJobs: 1 }));
      await expect(service.assertUploadQuota('u1', 1024)).rejects.toMatchObject({
        response: { statusCode: 429, message: expect.stringContaining('already being processed') },
      } satisfies Record<string, unknown>);
    });

    it('users are isolated — u2 is unaffected by u1 exhausting the hour window', async () => {
      const service = makeService(makeRepo());
      for (let i = 0; i < QUOTA_LIMITS.DOCUMENTS_PER_HOUR; i++) {
        await service.assertUploadQuota('u1', 1024);
      }
      await expect(service.assertUploadQuota('u2', 1024)).resolves.toBeUndefined();
    });
  });

  describe('assertCanReprocess', () => {
    it('admits the first two attempts and rejects the third for the same document', async () => {
      const service = makeService(makeRepo());
      await service.assertCanReprocess('doc1');
      await service.assertCanReprocess('doc1');
      await expect(service.assertCanReprocess('doc1')).rejects.toMatchObject({
        response: { statusCode: 429, message: expect.stringContaining('Reprocess limit') },
      } satisfies Record<string, unknown>);
    });

    it('the reprocess counter is per document, not per user', async () => {
      const service = makeService(makeRepo());
      await service.assertCanReprocess('doc1');
      await service.assertCanReprocess('doc1');
      await expect(service.assertCanReprocess('doc2')).resolves.toBeUndefined();
    });
  });

  describe('assertCanCreateSample', () => {
    it('admits one sample per day and rejects the second', async () => {
      const service = makeService(makeRepo());
      await service.assertCanCreateSample('u1');
      await expect(service.assertCanCreateSample('u1')).rejects.toMatchObject({
        response: { statusCode: 429, message: expect.stringContaining('Sample limit') },
      } satisfies Record<string, unknown>);
    });

    it('admits again the next day', async () => {
      const service = makeService(makeRepo());
      await service.assertCanCreateSample('u1');
      jest.setSystemTime(new Date(Date.now() + DAY_MS + 1_000));
      await expect(service.assertCanCreateSample('u1')).resolves.toBeUndefined();
    });

    it('users are isolated — u2 can still take a sample after u1 used theirs', async () => {
      const service = makeService(makeRepo());
      await service.assertCanCreateSample('u1');
      await expect(service.assertCanCreateSample('u2')).resolves.toBeUndefined();
    });
  });

  it('fails open when Redis is unavailable', async () => {
    redis.incr.mockRejectedValue(new Error('down'));
    const service = makeService(makeRepo());
    await expect(service.assertCanCreateSample('u1')).resolves.toBeUndefined();
  });
});
