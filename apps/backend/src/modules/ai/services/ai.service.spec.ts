import { AiService } from './ai.service';

// H-1 (audit wave 3): retry/fallback contract of fetchWithRetry.
// 429 must fail over to the next model immediately (same-model retries only
// burn the budget — Z.ai "busy" won't clear in seconds); 5xx gets one
// same-model retry with backoff before the failover; 4xx throws at once.

type FetchCall = { model: string };

function makeService(env: Record<string, string> = {}): AiService {
  const config: Record<string, string> = {
    GLM_API_KEY: 'test-key',
    GLM_MODEL: 'model-a',
    GLM_FALLBACK_MODELS: 'model-b',
    ...env,
  };
  return new AiService({
    get: (key: string) => config[key],
  } as never);
}

const okBody = {
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

const jsonResponse = () =>
  ({
    ok: true,
    status: 200,
    json: async () => okBody,
  }) as unknown as Response;

const errorResponse = (status: number) =>
  ({
    ok: false,
    status,
    text: async () => `error ${status}`,
  }) as unknown as Response;

/** Install a global.fetch stub answering with the given factories in order. */
function mockFetch(handlers: Array<(call: FetchCall) => Response>): {
  calls: FetchCall[];
  restore: () => void;
} {
  const calls: FetchCall[] = [];
  const impl = async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { model: string };
    calls.push({ model: body.model });
    return handlers[Math.min(calls.length - 1, handlers.length - 1)](calls[calls.length - 1]);
  };
  jest.spyOn(global, 'fetch').mockImplementation(impl as typeof fetch);
  return { calls, restore: () => jest.restoreAllMocks() };
}

describe('AiService — retry / failover (H-1)', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('succeeds on the first attempt without extra calls', async () => {
    const service = makeService();
    const { calls, restore } = mockFetch([() => jsonResponse()]);

    const res = await service.sendMessage('hello');

    expect(res.text).toBe('ok');
    expect(calls).toEqual([{ model: 'model-a' }]);
    restore();
  });

  it('fails over immediately on 429 without retrying the same model', async () => {
    const service = makeService();
    const { calls, restore } = mockFetch([
      () => errorResponse(429), // model-a: busy
      () => jsonResponse(), // model-b: fine
    ]);

    const res = await service.sendMessage('hello');

    expect(res.text).toBe('ok');
    expect(calls).toEqual([{ model: 'model-a' }, { model: 'model-b' }]);
    restore();
  });

  it('throws after exactly one attempt per model when every model is rate-limited', async () => {
    const service = makeService();
    const { calls, restore } = mockFetch([() => errorResponse(429)]);

    await expect(service.sendMessage('hello')).rejects.toThrow(/429/);

    expect(calls).toEqual([{ model: 'model-a' }, { model: 'model-b' }]);
    restore();
  });

  it('retries the same model once on 5xx, then fails over', async () => {
    jest.useFakeTimers();
    const service = makeService();
    const { calls, restore } = mockFetch([
      () => errorResponse(500), // model-a attempt 1
      () => errorResponse(500), // model-a attempt 2
      () => jsonResponse(), // model-b
    ]);

    const pending = service.sendMessage('hello');
    // drain first attempt, then the backoff window (base 6s ± jitter), then settle
    await jest.advanceTimersByTimeAsync(50);
    await jest.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toHaveProperty('text', 'ok');
    expect(calls.map((c) => c.model)).toEqual(['model-a', 'model-a', 'model-b']);
    restore();
  });

  it('throws immediately on a non-retryable 4xx without any retry or failover', async () => {
    const service = makeService();
    const { calls, restore } = mockFetch([() => errorResponse(401)]);

    await expect(service.sendMessage('hello')).rejects.toThrow(/401/);

    expect(calls).toEqual([{ model: 'model-a' }]);
    restore();
  });
});
