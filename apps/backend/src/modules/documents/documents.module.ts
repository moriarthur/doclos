import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { DocumentsService } from './documents.service';
import { DocumentsController } from './documents.controller';
import { OcrModule } from '../ocr/ocr.module';
import { AiModule } from '../ai/ai.module';
import { Document } from './entities/document.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { Customer } from './entities/customer.entity';
import { FieldExtraction } from './entities/field-extraction.entity';
import { AuditLog } from '../jobs/entities/audit-log.entity';
import { Job } from '../jobs/entities/job.entity';
import { DocumentProcessor } from './processors/document.processor';
import { DocumentsRecoveryService } from './documents-recovery.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Document,
      Invoice,
      InvoiceItem,
      Customer,
      FieldExtraction,
      AuditLog,
      Job,
    ]),
    BullModule.registerQueue({
      name: 'documents',
    }),
    OcrModule,
    AiModule,
  ],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentProcessor, DocumentsRecoveryService],
  exports: [DocumentsService],
})
export class DocumentsModule {}
