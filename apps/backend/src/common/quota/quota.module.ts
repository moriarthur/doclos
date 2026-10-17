import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Document } from '../../modules/documents/entities/document.entity';
import { QuotaService } from './quota.service';

// PD-R2: per-user/per-document quota admission. AppModule registers the
// QuotaExceptionFilter globally; services inject QuotaService.
@Module({
  imports: [TypeOrmModule.forFeature([Document])],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
