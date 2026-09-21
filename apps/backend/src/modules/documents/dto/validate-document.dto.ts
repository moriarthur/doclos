import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Part 4: API Specification - Validate document DTO
// Part 7: Security & GDPR - Audit log on validation

// P2-1 (audit): explicit contract per field — a present string/number sets
// the value, explicit null CLEARS it (the old truthy checks made clearing
// impossible), an absent key leaves the field untouched. Unknown keys are
// rejected by the global ValidationPipe (forbidNonWhitelisted).
export class ValidateInvoiceFieldsDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoice_number?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'invoice_date must be YYYY-MM-DD' })
  invoice_date?: string | null;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'due_date must be YYYY-MM-DD' })
  due_date?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  amount_total?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  supplier_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  supplier_address?: string | null;
}

export class ValidateDocumentDto {
  @ValidateNested()
  @Type(() => ValidateInvoiceFieldsDto)
  fields: ValidateInvoiceFieldsDto;
}

// Part 4: API Specification - Field with confidence
export class FieldWithConfidence {
  @IsString()
  value: string;

  @IsNumber()
  confidence: number;
}

// Part 4: API Specification - Document detail response
export class DocumentDetailDto {
  id: string;
  status: string;
  file_url: string;
  invoice?: {
    invoice_number?: FieldWithConfidence;
    amount_total?: FieldWithConfidence;
    currency?: string;
    invoice_date?: string;
    due_date?: string;
    supplier_name?: FieldWithConfidence;
    supplier_address?: FieldWithConfidence;
  };
}
