import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { S3Service } from './services/s3.service';
import { StorageCleanupService } from './services/storage-cleanup.service';
import { PendingStorageDeletion } from './entities/pending-storage-deletion.entity';

// Storage module for file upload/download
// Part 8: Infrastructure & Deployment - Object storage

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([PendingStorageDeletion])],
  providers: [S3Service, StorageCleanupService],
  exports: [S3Service, StorageCleanupService],
})
export class StorageModule {}
