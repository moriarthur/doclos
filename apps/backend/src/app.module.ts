import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { SearchModule } from './modules/search/search.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { StorageModule } from './modules/storage/storage.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { AiModule } from './modules/ai/ai.module';
import { ExportModule } from './modules/export/export.module';
import { dataSourceOptions } from './database/data-source';

// Part 1: System Architecture - Root application module

// Parse Redis URL to extract password for Upstash
const redisUrl = process.env.REDIS_URL || '';
const redisPassword = redisUrl.match(/rediss?:\/\/[^:]+:([^@]+)@/)?.[1];

@Module({
  imports: [
    // Rate limiting — guards every route; auth routes get a stricter limit
    // via @Throttle() on AuthController. TTL is in milliseconds (throttler v5+).
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),

    // Configuration - loads .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
    }),

    // Database - TypeORM with PostgreSQL
    TypeOrmModule.forRoot(dataSourceOptions),

    // Queue - Bull with Redis (Upstash with TLS)
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: redisPassword,
        tls: process.env.REDIS_URL?.startsWith('rediss://') ? {} : undefined,
        // Required by Bull: the worker pulls jobs with a blocking command
        // (BRPOPLPUSH). Without these, ioredis aborts that blocking request
        // after its retry limit once Upstash drops an idle connection, and the
        // worker permanently stops consuming the queue (jobs pile up in "wait"
        // with active=0). maxRetriesPerRequest:null disables that limit;
        // enableReadyCheck:false avoids ready-check stalls on the bclient.
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      },
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    }),

    // Feature modules
    StorageModule,
    OcrModule,
    AiModule,
    AuthModule,
    DocumentsModule,
    SearchModule,
    JobsModule,
    ExportModule,
  ],
  controllers: [],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
