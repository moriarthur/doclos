import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
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
  providers: [],
})
export class AppModule {}
