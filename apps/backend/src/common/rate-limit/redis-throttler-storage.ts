import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { ThrottlerStorage } from '@nestjs/throttler';
import { redisConnectionOptions } from '../../config/redis-options';

// The record interface isn't re-exported from the package index — derive it.
type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// PD-R1 (public-demo audit): the @nestjs/throttler default store is in-memory
// — limits reset on every restart and never share state across instances,
// which the audit only tolerates as an additional layer. Redis is already a
// hard dependency (Bull queue), so the counters live there: one fixed-window
// counter per key (INCR + first-hit PEXPIRE), same semantics the guard
// expects (times in seconds).
//
// Fail-open on Redis outages: the demo stays usable and the queue (which has
// its own connection) is unaffected — a hard dependency on Redis for rate
// limiting would turn a Redis blip into a full API outage. This is documented
// as defense-in-depth, not the only abuse barrier (per-user quotas in
// common/quota fail the same way on purpose).
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private readonly redis: Redis;
  private redisDownLogged = false;

  constructor() {
    this.redis = new Redis({ ...redisConnectionOptions(), lazyConnect: false });
    this.redis.on('error', (err: Error) => {
      if (!this.redisDownLogged) {
        this.redisDownLogged = true;
        this.logger.error(`Rate-limit Redis unreachable — limits fail open until it returns: ${err.message}`);
      }
    });
    this.redis.on('ready', () => {
      if (this.redisDownLogged) {
        this.logger.log('Rate-limit Redis back online');
      }
      this.redisDownLogged = false;
    });
  }

  // Fewer params than the ThrottlerStorage interface is fine (TS structural
  // typing): this fixed-window store doesn't use limit/blockDuration/throttler
  // name — the guard owns the over-limit decision from totalHits alone.
  async increment(key: string, ttl: number): Promise<ThrottlerStorageRecord> {
    let totalHits: number;
    try {
      totalHits = await this.redis.incr(key);
      if (totalHits === 1) {
        // First hit in this window owns the TTL — the window is fixed from the
        // first request, matching the in-memory store's fixed-window behavior.
        await this.redis.pexpire(key, ttl);
      }
    } catch (err) {
      // Fail open: report a harmless record so the guard allows the request.
      this.logger.error(`Rate-limit increment failed (failing open): ${(err as Error).message}`);
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }

    // TTL could be missing if the INCR raced a key expiry between the two
    // commands (totalHits > 1 but TTL -1) — repair it instead of pinning the
    // counter forever.
    let pttl = await this.redis.pttl(key);
    if (pttl < 0) {
      await this.redis.pexpire(key, ttl);
      pttl = ttl;
    }

    return {
      totalHits,
      timeToExpire: Math.max(1, Math.ceil(pttl / 1000)),
      isBlocked: false,
      timeToBlockExpire: 0,
    };
  }

  async onApplicationShutdown(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
