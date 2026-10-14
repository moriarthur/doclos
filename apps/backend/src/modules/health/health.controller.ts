import { Controller, Get, Res, HttpStatus } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { DataSource } from 'typeorm';
import { Response } from 'express';

// Demo-preview deployment wiring.
// - GET /healthz  → liveness only (process up); no dependencies touched, so
//   platforms can probe it without auth or DB.
// - PD-H1: GET /readyz → dependency readiness: PostgreSQL, Redis/queue, and
//   storage configuration. Never exposes secrets or connection strings —
//   only per-dependency ok/fail. 503 when anything essential is down, so
//   Render can hold traffic back until the service is actually usable.
// Both live outside the /api/v1 prefix (see main.ts exclude).
@Controller()
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    @InjectQueue('documents') private readonly documentsQueue: Queue,
  ) {}

  @Get('healthz')
  check() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  @Get('readyz')
  async ready(@Res({ passthrough: true }) res: Response) {
    const checks = {
      postgres: await this.checkPostgres(),
      redis: await this.checkQueueRedis(),
      storage: this.checkStorageConfig(),
    };
    const healthy = Object.values(checks).every((c) => c === 'ok');

    res.status(healthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: healthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<'ok' | 'fail'> {
    try {
      await this.dataSource.query('SELECT 1');
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private async checkQueueRedis(): Promise<'ok' | 'fail'> {
    try {
      // The queue's own Redis connection — exactly what Bull workers use.
      const client = await this.documentsQueue.client;
      await client.ping();
      return 'ok';
    } catch {
      return 'fail';
    }
  }

  private checkStorageConfig(): 'ok' | 'fail' {
    const required = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'];
    // Presence + non-trivial length only — values are never read into the
    // response or logs.
    return required.every((name) => (process.env[name] ?? '').length >= 8) ? 'ok' : 'fail';
  }
}
