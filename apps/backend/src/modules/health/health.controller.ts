import { Controller, Get } from '@nestjs/common';

// Demo-preview deployment wiring: a public liveness probe for platform
// health checks. Intentionally outside the /api/v1 prefix (see main.ts
// exclude) and free of auth + DB dependencies, so it answers 200 as long
// as the process is up — readiness of dependencies is visible in the logs
// and the API routes themselves.
@Controller('healthz')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
