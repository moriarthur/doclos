import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import * as Joi from 'joi';
import { ThrottlerModule } from '@nestjs/throttler';
import { RateLimitModule } from './common/rate-limit/rate-limit.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import { RedisThrottlerStorage } from './common/rate-limit/redis-throttler-storage';
import { redisConnectionOptions } from './config/redis-options';
import { QuotaModule } from './common/quota/quota.module';
import { QuotaExceptionFilter } from './common/quota/quota.exceptions';
import { CsrfGuard } from './common/csrf/csrf.guard';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SearchModule } from './modules/search/search.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { StorageModule } from './modules/storage/storage.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { AiModule } from './modules/ai/ai.module';
import { ExportModule } from './modules/export/export.module';
import { HealthModule } from './modules/health/health.module';
import { dataSourceOptions } from './database/data-source';

// Part 1: System Architecture - Root application module

// PD-S2 (public-demo audit): values that must never be live in production —
// or anywhere, for the legacy demo password.
const PRODUCTION_FORBIDDEN_SECRETS = [
  'your-super-secret-jwt-key-change-in-production',
  'change-me-demo-1234',
];

@Module({
  imports: [
    // Rate limiting — guards every route; stricter budgets via @Throttle() on
    // the abusive routes (auth, upload, reprocess, demo sample). TTL is in
    // milliseconds (throttler v5+). PD-R1: counters live in Redis so limits
    // survive restarts and share state across instances.
    ThrottlerModule.forRootAsync({
      imports: [RateLimitModule],
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ ttl: 60_000, limit: 120 }],
        storage,
      }),
    }),

    // Configuration - loads .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      // P2-6 (audit): fail fast on missing critical configuration instead of
      // dying later with cryptic connection/auth errors.
      // PD-S2 (public-demo audit): production additionally refuses weak or
      // placeholder secrets and demands FRONTEND_URL.
      validationSchema: Joi.object({
        DATABASE_URL: Joi.string().required(),
        REDIS_URL: Joi.string().required(),
        JWT_SECRET: Joi.string()
          .min(32)
          .max(256)
          .required()
          .when('NODE_ENV', {
            is: 'production',
            then: Joi.invalid(...PRODUCTION_FORBIDDEN_SECRETS),
          }),
        S3_ENDPOINT: Joi.string().required(),
        S3_BUCKET: Joi.string().required(),
        S3_ACCESS_KEY_ID: Joi.string().required(),
        S3_SECRET_ACCESS_KEY: Joi.string().required(),
        GLM_API_KEY: Joi.string().required(),
        FRONTEND_URL: Joi.string().uri().when('NODE_ENV', {
          is: 'production',
          then: Joi.required(),
        }),
        NODE_ENV: Joi.string().valid('development', 'production', 'test'),
        // PD-R4: trusted reverse-proxy hops in front of the API (Render = 1).
        // 0 disables X-Forwarded-For handling — MUST stay 0 when the API is
        // reachable directly, or clients could forge their rate-limit IP.
        TRUST_PROXY_HOPS: Joi.number().integer().min(0).max(10),
        // PD-S2: if the legacy demo-password var is still around anywhere, the
        // placeholder value must never be live in any environment.
        DEMO_PASSWORD: Joi.string().invalid(...PRODUCTION_FORBIDDEN_SECRETS),
      }),
      validationOptions: { abortEarly: false },
    }),

    // Database - TypeORM with PostgreSQL
    TypeOrmModule.forRoot(dataSourceOptions),

    // Queue - Bull with Redis (REDIS_URL-first: Upstash TLS / Render KV fallback)
    BullModule.forRoot({
      redis: redisConnectionOptions(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),

    // Feature modules
    RateLimitModule,
    QuotaModule,
    StorageModule,
    OcrModule,
    AiModule,
    AuthModule,
    DocumentsModule,
    SearchModule,
    JobsModule,
    ExportModule,
    HealthModule,
  ],
  controllers: [],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // PD-A3: double-submit CSRF for the cookie transport — runs after the
    // rate limiter, before route-level auth guards.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: QuotaExceptionFilter },
  ],
})
export class AppModule {}
