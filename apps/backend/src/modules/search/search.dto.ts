import {
  IsString,
  IsOptional,
  IsEnum,
  IsDateString,
  IsInt,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DocumentStatus, DocumentType } from '../documents/entities/document.entity';

// GET /api/v1/search — full-text search across documents + related invoice/customer fields.
export class SearchQueryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsEnum(DocumentStatus)
  status?: DocumentStatus;

  @IsOptional()
  @IsEnum(DocumentType)
  type?: DocumentType;

  @IsOptional()
  @IsDateString()
  from_date?: string;

  @IsOptional()
  @IsDateString()
  to_date?: string;
}
