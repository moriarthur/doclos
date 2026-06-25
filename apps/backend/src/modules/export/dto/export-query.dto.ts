import { IsEnum, IsIn, IsOptional, IsString } from 'class-validator';
import { DocumentStatus } from '../../documents/entities/document.entity';

// Part 6: Excel Export System — filters for the export endpoint
export class ExportQueryDto {
  @IsOptional()
  @IsString()
  from_date?: string; // YYYY-MM-DD (compared against invoice.invoice_date)

  @IsOptional()
  @IsString()
  to_date?: string; // YYYY-MM-DD

  @IsOptional()
  @IsString()
  company?: string; // supplier name substring (ILIKE)

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsString()
  ids?: string; // comma-separated document IDs — export only the selected documents

  @IsOptional()
  @IsIn(['de', 'en'])
  lang?: string; // UI locale for localized export headers/labels ('de' fallback)
}
