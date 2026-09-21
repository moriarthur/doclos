import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { DocumentStatus } from '../entities/document.entity';

// Audit cleanup: exclude_status used to pass through as `as any` — a garbage
// value (e.g. ?exclude_status=zzz) reached the PG enum comparison and 500'd
// (22P02). The whole query now validates; unknown keys are rejected by the
// global forbidNonWhitelisted pipe.
const STATUS_VALUES = Object.values(DocumentStatus) as string[];

export class ListDocumentsQueryDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  status?: DocumentStatus;

  @IsOptional()
  @IsIn(STATUS_VALUES)
  exclude_status?: DocumentStatus;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;
}
