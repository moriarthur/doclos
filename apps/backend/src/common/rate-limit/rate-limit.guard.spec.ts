import { ExecutionContext, HttpException } from '@nestjs/common';
import { RateLimitGuard } from './rate-limit.guard';

// PD-R5: 429s must carry retry information (header + body).
describe('RateLimitGuard', () => {
  const makeContext = () => {
    const headers: Record<string, string> = {};
    const response = { setHeader: (name: string, value: string) => (headers[name] = value) };
    const context = {
      switchToHttp: () => ({ getResponse: () => response }),
      getClass: () => ({ name: 'FakeController' }),
      getHandler: () => jest.fn(),
    } as unknown as ExecutionContext;
    return { context, headers };
  };

  const makeGuard = () =>
    Object.create(RateLimitGuard.prototype) as RateLimitGuard & {
      throwThrottlingException: (
        context: ExecutionContext,
        detail: Record<string, unknown>,
      ) => Promise<void>;
    };

  it('throws 429 with Retry-After header derived from the window', async () => {
    const guard = makeGuard();
    const { context, headers } = makeContext();

    const detail = {
      totalHits: 6,
      timeToExpire: 42.4,
      isBlocked: false,
      timeToBlockExpire: 0,
      ttl: 60_000,
      limit: 5,
      key: 'k',
      tracker: 'ip',
    };

    await expect(
      guard.throwThrottlingException(context, detail as never),
    ).rejects.toMatchObject({
      status: 429,
      response: {
        statusCode: 429,
        retryAfterSeconds: 43,
        message: expect.stringContaining('43 second(s)'),
      },
    } satisfies Record<string, unknown>);
    expect(headers['Retry-After']).toBe('43');
  });

  it('uses the block window when the store reports a block', async () => {
    const guard = makeGuard();
    const { context, headers } = makeContext();

    const detail = {
      totalHits: 6,
      timeToExpire: 10,
      isBlocked: true,
      timeToBlockExpire: 120,
      ttl: 60_000,
      limit: 5,
      key: 'k',
      tracker: 'ip',
    };

    await expect(guard.throwThrottlingException(context, detail as never)).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(headers['Retry-After']).toBe('120');
  });

  it('never reports a non-positive retry', async () => {
    const guard = makeGuard();
    const { context, headers } = makeContext();

    const detail = {
      totalHits: 6,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
      ttl: 60_000,
      limit: 5,
      key: 'k',
      tracker: 'ip',
    };

    await expect(guard.throwThrottlingException(context, detail as never)).rejects.toMatchObject({
      response: { retryAfterSeconds: 1 },
    });
    expect(headers['Retry-After']).toBe('1');
  });
});
