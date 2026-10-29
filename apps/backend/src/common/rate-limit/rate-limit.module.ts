import { Module } from '@nestjs/common';
import { RedisThrottlerStorage } from './redis-throttler-storage';
import { RateLimitGuard } from './rate-limit.guard';

// PD-R1: shared rate-limit infrastructure — Redis-backed counters + the
// friendly-429 guard. AppModule consumes both.
@Module({
  providers: [RedisThrottlerStorage, RateLimitGuard],
  exports: [RedisThrottlerStorage, RateLimitGuard],
})
export class RateLimitModule {}
