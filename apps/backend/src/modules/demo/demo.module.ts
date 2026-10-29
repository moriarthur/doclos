import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentsModule } from '../documents/documents.module';
import { QuotaModule } from '../../common/quota/quota.module';
import { AuthModule } from '../auth/auth.module';
import { DemoController } from './demo.controller';
import { DemoService } from './demo.service';
import { DemoRetentionService } from './demo-retention.service';
import { Document } from '../documents/entities/document.entity';
import { User } from '../auth/entities/user.entity';

// PD-D1: per-user synthetic sample flow + PD-D3 retention cleanup.
@Module({
  imports: [
    TypeOrmModule.forFeature([Document, User]),
    DocumentsModule,
    QuotaModule,
    AuthModule,
  ],
  controllers: [DemoController],
  providers: [DemoService, DemoRetentionService],
  exports: [DemoService],
})
export class DemoModule {}
