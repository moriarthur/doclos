// Force IPv4 DNS resolution — WSL2 doesn't route IPv6 to external hosts
import * as dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { resolvePort } from './config/resolve-port';

// Part 4: API Specification - CORS, Validation, Global Prefix

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const isProduction = configService.get('NODE_ENV') === 'production';

  // Security headers (HSTS, X-Frame-Options, no-sniff, etc.)
  app.use(helmet());

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

  // Global prefix — /healthz stays at the root so deployment platforms can
  // probe it without knowing the API version prefix
  app.setGlobalPrefix('api/v1', { exclude: ['healthz'] });

  // CORS — production allows only the configured frontend origin; dev also
  // allows localhost variants.
  const frontendUrl = configService.get('FRONTEND_URL') || 'http://localhost:3000';
  app.enableCors({
    origin: isProduction
      ? [frontendUrl]
      : [frontendUrl, 'http://localhost:3000', 'http://127.0.0.1:3000'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
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
