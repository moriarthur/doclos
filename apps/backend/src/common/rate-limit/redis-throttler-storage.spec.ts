import { RedisThrottlerStorage } from './redis-throttler-storage';

// PD-R1: fixed-window Redis counters behind the throttler's storage contract.
// The Redis client is mocked — the unit suite never touches a live Redis.
describe('RedisThrottlerStorage', () => {
  const makeRedis = (over: Partial<Record<'incr' | 'pexpire' | 'pttl' | 'quit', never>> = {}) => {
    const store = new Map<string, number>();
    const redis = {
      incr: jest.fn(async (key: string) => {
        store.set(key, (store.get(key) ?? 0) + 1);
        return store.get(key)!;
      }),
      pexpire: jest.fn(async (key: string, ms: number) => {
        store.set(`ttl:${key}`, ms);
        return 1;
      }),
      pttl: jest.fn(async (key: string) => store.get(`ttl:${key}`) ?? 60_000),
      quit: jest.fn(async () => undefined),
      on: jest.fn(),
      ...over,
    };
    return { redis, store };
  };

  const makeStorage = (redis: Record<string, unknown>) => {
    // Bypass the constructor's own client — inject the mock directly.
    const storage = Object.create(RedisThrottlerStorage.prototype);
    Object.defineProperty(storage, 'redis', { value: redis });
    Object.defineProperty(storage, 'logger', {
      value: { error: jest.fn(), log: jest.fn() },
    });
    return storage as RedisThrottlerStorage;
  };

  it('counts hits per key and returns seconds until expiry', async () => {
    const { redis } = makeRedis();
    const storage = makeStorage(redis);

    const first = await storage.increment('k', 60_000);
    expect(first.totalHits).toBe(1);
    const second = await storage.increment('k', 60_000);
    expect(second.totalHits).toBe(2);
    expect(second.timeToExpire).toBeGreaterThan(0);
    expect(second.timeToExpire).toBeLessThanOrEqual(60);
    // Only the first hit in a window sets the TTL (fixed window).
    expect(redis.pexpire).toHaveBeenCalledTimes(1);
  });

  it('separate keys count independently (per-IP / per-user isolation)', async () => {
    const { redis } = makeRedis();
    const storage = makeStorage(redis);

    await storage.increment('user-a', 60_000);
    await storage.increment('user-a', 60_000);
    const other = await storage.increment('user-b', 60_000);
    expect(other.totalHits).toBe(1);
  });

  it('repairs a lost TTL instead of pinning the counter forever', async () => {
    const { redis } = makeRedis({
      pttl: (async () => -1) as never,
    });
    const storage = makeStorage(redis);

    const record = await storage.increment('k', 60_000);
    expect(record.timeToExpire).toBe(60);
    expect(redis.pexpire).toHaveBeenCalled();
  });

  it('fails open when Redis is unreachable', async () => {
    const { redis } = makeRedis({
      incr: (async () => {
        throw new Error('connection down');
      }) as never,
    });
    const storage = makeStorage(redis);

    const record = await storage.increment('k', 60_000);
    expect(record).toEqual({ totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 });
  });

  it('shutdown closes the connection', async () => {
    const { redis } = makeRedis();
    const storage = makeStorage(redis);
    await storage.onApplicationShutdown();
    expect(redis.quit).toHaveBeenCalled();
  });
});
