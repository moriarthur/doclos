import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
  ArrayMaxSize,
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

// U-4 (editable line items): one editable row of the items table. Full
// whitelist — the global ValidationPipe runs with forbidNonWhitelisted, so
// any other key in an item is rejected. Absent key = untouched semantics do
// NOT apply here: the client sends the complete edited table and the service
// replaces all rows.
export class ValidateInvoiceItemDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  quantity?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  unit_price?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  line_total?: number | null;
}

export class ValidateDocumentDto {
  // Deliberately permissive: besides the invoice fields below, S5.2 clients
  // send per-type metadata fields (dynamic per document.type). The known
  // invoice fields are re-validated in the service (dates, amounts, lengths,
  // explicit-null clearing) against ValidateInvoiceFieldsDto; metadata keys
  // are whitelisted per type by METADATA_FIELDS_BY_TYPE and sanitized.
  @IsObject()
  fields: Record<string, string | number | null>;

  // U-4: when present, the full edited line-items table replaces all stored
  // rows (see DocumentsService.validateDocument). Only valid for documents
  // with an invoice carrier (invoice / purchase_order / offer / delivery_note).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ValidateInvoiceItemDto)
  items?: ValidateInvoiceItemDto[];
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
