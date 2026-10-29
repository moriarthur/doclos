import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bull';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const passthrough = () => {
    const state = { status: 0 };
    const res = {
      status: (code: number) => {
        state.status = code;
        return res;
      },
    };
    return { res: res as unknown as Parameters<HealthController['ready']>[0], state };
  };

  const okQueue = { client: Promise.resolve({ ping: async () => 'PONG' }) };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    })
      .useMocker((token) => {
        if (token === DataSource) {
          return { query: async () => [{ '?column?': 1 }] };
        }
        if (token === getQueueToken('documents')) {
          return okQueue;
        }
        return {};
      })
      .compile();
    controller = moduleRef.get(HealthController);
  });

  it('reports ok with uptime and timestamp (liveness)', () => {
    const result = controller.check();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('readyz reports all-ok with every dependency healthy', async () => {
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'doclos-documents';
    process.env.S3_ACCESS_KEY_ID = '0123456789abcdef';
    process.env.S3_SECRET_ACCESS_KEY = '0123456789abcdef';

    const { res, state } = passthrough();
    const result = (await controller.ready(res)) as { status: string; checks: Record<string, string> };

    expect(state.status).toBe(HttpStatus.OK);
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ postgres: 'ok', redis: 'ok', storage: 'ok' });
  });

  it('readyz answers 503 when postgres is unreachable', async () => {
    process.env.S3_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
    process.env.S3_BUCKET = 'doclos-documents';
    process.env.S3_ACCESS_KEY_ID = '0123456789abcdef';
    process.env.S3_SECRET_ACCESS_KEY = '0123456789abcdef';

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
    })
      .useMocker((token) => {
        if (token === DataSource) {
          return { query: async () => { throw new Error('db down'); } };
        }
        if (token === getQueueToken('documents')) {
          return okQueue;
        }
        return {};
      })
      .compile();
    controller = moduleRef.get(HealthController);

    const { res, state } = passthrough();
    const result = (await controller.ready(res)) as { status: string; checks: Record<string, string> };

    expect(state.status).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(result.checks.postgres).toBe('fail');
  });

  it('readyz never includes secrets or connection strings', async () => {
    process.env.S3_ENDPOINT = 'https://secret-endpoint.example.com';
    process.env.S3_BUCKET = 'secret-bucket';
    process.env.S3_ACCESS_KEY_ID = 'secret-key-id-012345';
    process.env.S3_SECRET_ACCESS_KEY = 'secret-key-0123456789';

    const { res } = passthrough();
    const serialized = JSON.stringify(await controller.ready(res));
    expect(serialized).not.toContain('secret');
  });
});
