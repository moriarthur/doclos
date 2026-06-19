import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { Document } from '../documents/entities/document.entity';
import { ExportService } from './export.service';
import { ExportController } from './export.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, InvoiceItem, Document])],
  controllers: [ExportController],
  providers: [ExportService],
})
export class ExportModule {}
