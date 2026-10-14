// Force IPv4 DNS resolution — WSL2 doesn't route IPv6 to external hosts
import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { AppModule } from './app.module';
import { resolvePort } from './config/resolve-port';

// Part 4: API Specification - CORS, Validation, Global Prefix

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const isProduction = configService.get('NODE_ENV') === 'production';

  // Security headers (HSTS, X-Frame-Options, no-sniff, etc.)
  app.use(helmet());

  // PD-A1: cookie-based auth transport — parse cookies for the JWT strategy
  // and the CSRF double-submit guard.
  app.use(cookieParser.default());

  // PD-R4 (public-demo audit): rate limiting keys on req.ip, which Express
  // only resolves from X-Forwarded-For when the proxy chain length is trusted.
  // Render fronts the API with exactly one reverse proxy → TRUST_PROXY_HOPS=1
  // makes req.ip the LAST XFF entry (set by the trusted proxy from the real
  // socket), so client-supplied XFF entries are ignored, not spoofable.
  // Keep 0 whenever the API is exposed directly (default outside production).
  const trustProxyHops = process.env.TRUST_PROXY_HOPS ?? (isProduction ? '1' : '0');
  const hops = Number(trustProxyHops);
  if (!Number.isInteger(hops) || hops < 0 || hops > 10) {
    throw new Error(`Invalid TRUST_PROXY_HOPS: ${trustProxyHops} (expected integer 0-10)`);
  }
  // Express-level setting (req.ip resolution) — INestApplication doesn't
  // expose .set(), go through the underlying Express instance.
  app.getHttpAdapter().getInstance().set('trust proxy', hops);

  // Global prefix — /healthz (liveness) and /readyz (PD-H1 readiness) stay at
  // the root so deployment platforms can probe them without the API prefix
  app.setGlobalPrefix('api/v1', { exclude: ['healthz', 'readyz'] });

  // PD-H2 (public-demo audit): request correlation ID — honor a sane inbound
  // X-Request-ID, else mint one; always echoed back so clients and logs line
  // up. Request logs below carry method/path/status/duration ONLY — no query
  // strings (search terms are user content), no bodies, no user IDs.
  const httpLogger = new Logger('HTTP');
  app.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(incoming)
        ? incoming
        : crypto.randomUUID();
    res.setHeader('X-Request-Id', requestId);

    const startedAt = Date.now();
    res.on('finish', () => {
      // Probe endpoints would drown the log — skip them.
      if (req.path === '/healthz' || req.path === '/readyz') return;
      httpLogger.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms [${requestId}]`);
    });
    next();
  });

  // CORS — production allows only the configured frontend origin; dev also
  // allows localhost variants.
  const frontendUrl = configService.get('FRONTEND_URL') || 'http://localhost:3000';
  app.enableCors({
    origin: isProduction
      ? [frontendUrl]
      : [frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // PD-A3: X-CSRF-Token is the double-submit header for cookie auth.
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token'],
  });

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // P2-6 (audit): graceful shutdown — lets Bull drain running jobs on SIGTERM
  app.enableShutdownHooks();

  // PD-DEP1 (public-demo audit): platform-injected PORT (Render) wins over
  // APP_PORT; Nest's default host is 0.0.0.0, which is what platforms need.
  const port = resolvePort(process.env);
  await app.listen(port);

  console.log(`🚀 Doclos API running on: http://localhost:${port}/api/v1`);
}

bootstrap();
