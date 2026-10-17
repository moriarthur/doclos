import { ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerLimitDetail } from '@nestjs/throttler';

// PD-R5 (public-demo audit): the stock ThrottlerException gives clients a bare
// 429 with no way to know when to retry. This guard keeps all of the stock
// throttling behavior (per-route @Throttle overrides, Redis storage) but
// answers with a machine- and human-friendly body plus a standard Retry-After
// header.
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    // Storage reports seconds until the current window expires (block window
    // when the store uses blocking, otherwise the count window).
    const retryAfterSeconds = Math.max(
      1,
      detail.isBlocked && detail.timeToBlockExpire > 0
        ? Math.ceil(detail.timeToBlockExpire)
        : Math.ceil(detail.timeToExpire),
    );

    const response = context.switchToHttp().getResponse();
    response.setHeader('Retry-After', String(retryAfterSeconds));

    throw new HttpException(
      {
        statusCode: 429,
        error: 'Too Many Requests',
        message: `Rate limit exceeded — retry in ${retryAfterSeconds} second(s)`,
        retryAfterSeconds,
      },
      429,
    );
  }
}
