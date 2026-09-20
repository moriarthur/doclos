import { Injectable, Logger } from '@nestjs/common';
import { AiService } from './ai.service';
import {
  INVOICE_EXTRACTION_SYSTEM,
  INVOICE_EXTRACTION_PROMPT,
  CONFIDENCE_ASSESSMENT_PROMPT,
} from '../prompts/extraction.prompts';

// Part 3: AI Pipeline - Structured data extraction service
// Extracts invoice data using Claude LLM

export interface InvoiceExtraction {
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  amount_total: number | null;
  vat_amount: number | null;
  currency: string | null;
  supplier_name: string | null;
  supplier_address: string | null;
  vat_rate?: number | null;
  customer_name?: string | null;
  items?: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    line_total: number;
  }>;
}

export interface ExtractionWithConfidence {
  data: InvoiceExtraction;
  confidence: {
    overall: number;
    fields: Record<string, number>;
  };
  cost: number;
}

@Injectable()
export class StructuredExtractionService {
  private readonly logger = new Logger(StructuredExtractionService.name);

  constructor(private aiService: AiService) {}

  /**
   * Extract structured invoice data from document text
   * @param text - OCR-extracted text from the document
   * @returns Extraction result with confidence scores
   */
  async extractInvoiceData(text: string): Promise<ExtractionWithConfidence> {
    if (!this.aiService.isAvailable()) {
      throw new Error('AI service not available - cannot perform extraction');
    }

    try {
      this.logger.log('Extracting invoice data with LLM');

      // Step 1: Extract structured data
      const extractionPrompt = INVOICE_EXTRACTION_PROMPT(text);
      const { data: extraction, usage } = await this.aiService.sendJsonMessage<InvoiceExtraction>(
        extractionPrompt,
        INVOICE_EXTRACTION_SYSTEM,
      );

      // Step 2: Assess confidence for each field
      const confidence = await this.assessConfidence(extraction, text);

      const cost = this.aiService.estimateCost(usage.inputTokens, usage.outputTokens);

      this.logger.log(
        `Invoice extraction complete - Overall confidence: ${confidence.overall.toFixed(2)} (cost: $${cost.toFixed(4)})`,
      );

      return { data: extraction, confidence, cost };
    } catch (error) {
      this.logger.error(`Invoice extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Assess confidence scores for extracted fields
   * @param extraction - Extracted data
   * @param text - Original text for verification
   * @returns Confidence scores
   */
  private async assessConfidence(
    extraction: InvoiceExtraction,
    text: string,
  ): Promise<{ overall: number; fields: Record<string, number> }> {
    try {
      const prompt = CONFIDENCE_ASSESSMENT_PROMPT(extraction, text);
      const { data } = await this.aiService.sendJsonMessage<{
        overall_confidence: number;
        field_confidence: Record<string, number>;
        issues: string[];
      }>(prompt);

      return {
        overall: data.overall_confidence,
        fields: data.field_confidence,
      };
    } catch (error) {
      this.logger.warn(`Confidence assessment failed: ${error instanceof Error ? error.message : String(error)}`);
      // Return default confidence scores
      return {
        overall: 0.7,
        fields: {
          invoice_number: 0.7,
          amount_total: 0.7,
          invoice_date: 0.7,
        },
      };
    }
  }

  /**
   * Normalize extracted data
   * Applies validation and formatting rules
   * @param extraction - Raw extraction result
   * @returns Normalized extraction
   */
  normalizeExtraction(extraction: InvoiceExtraction): InvoiceExtraction {
    const normalized = { ...extraction };

    // Normalize dates to ISO format
    if (normalized.invoice_date && typeof normalized.invoice_date === 'string') {
      normalized.invoice_date = this.normalizeDate(normalized.invoice_date);
    }
    if (normalized.due_date && typeof normalized.due_date === 'string') {
      normalized.due_date = this.normalizeDate(normalized.due_date);
    }

    // Ensure amounts are numbers — P1-2 (audit): German-formatted amounts
    // ("1.200,50", "1200,50") must not be fed to parseFloat raw
    if (normalized.amount_total && typeof normalized.amount_total === 'string') {
      normalized.amount_total = this.parseAmount(normalized.amount_total);
    }
    if (normalized.vat_amount && typeof normalized.vat_amount === 'string') {
      normalized.vat_amount = this.parseAmount(normalized.vat_amount as string);
    }

    // Validate currency code
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }

    return normalized;
  }

  /**
   * Normalize date to ISO format
   * Handles German date format (DD.MM.YYYY)
   * @param dateStr - Date string
   * @returns ISO date string or null
   */
  private normalizeDate(dateStr: string): string | null {
    try {
      // P1-1 (audit): German DD.MM.YYYY must be checked BEFORE new Date(),
      // which parses "03.04.2026" as MM.DD.YYYY and silently swaps day/month
      const germanMatch = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (germanMatch) {
        const [, day, month, year] = germanMatch;
        return `${year}-${month}-${day}`;
      }

      // Strict ISO only — anything else is unparseable, not a Date() gamble
      if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
        const isoDate = new Date(dateStr);
        if (!isNaN(isoDate.getTime())) {
          return isoDate.toISOString().split('T')[0];
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * P1-2 (audit): parse an amount string that may use German formatting.
   * "1.200,50" → 1200.5, "1200,50" → 1200.5, "€1200.50" → 1200.5
   * (the old strip-then-parseFloat turned "1.200,50" into 1.2)
   */
  private parseAmount(value: string): number {
    const trimmed = value.trim();
    // German with thousands separators: 1.200,50 (also negative)
    if (/^-?\d{1,3}(\.\d{3})+,\d{2}$/.test(trimmed)) {
      return parseFloat(trimmed.replace(/\./g, '').replace(',', '.'));
    }
    // German decimal comma without separators: 1200,50
    if (/^-?\d+,\d{2}$/.test(trimmed)) {
      return parseFloat(trimmed.replace(',', '.'));
    }
    // Fallback: strip currency symbols/spaces — plain "1200.50", US "1,200.50"
    const n = parseFloat(trimmed.replace(/[^\d.-]/g, ''));
    return isNaN(n) ? NaN : n;
  }

  /**
   * Validate extraction results
   * Checks for required fields and logical consistency
   * @param extraction - Extraction to validate
   * @returns Validation result with any issues found
   */
  validateExtraction(extraction: InvoiceExtraction): {
    isValid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check required fields
    if (!extraction.invoice_number) {
      issues.push('Invoice number is missing');
    }
    if (!extraction.amount_total) {
      issues.push('Total amount is missing');
    }
    if (!extraction.invoice_date) {
      issues.push('Invoice date is missing');
    }

    // Validate amounts
    if (extraction.amount_total && extraction.amount_total < 0) {
      issues.push('Total amount is negative');
    }
    if (extraction.vat_amount && extraction.vat_amount < 0) {
      issues.push('VAT amount is negative');
    }

    // Check dates
    if (extraction.due_date && extraction.invoice_date) {
      const dueDate = new Date(extraction.due_date);
      const invoiceDate = new Date(extraction.invoice_date);
      if (dueDate < invoiceDate) {
        issues.push('Due date is before invoice date');
      }
    }

    // Check item totals
    if (extraction.items && extraction.items.length > 0) {
      const itemsTotal = extraction.items.reduce((sum, item) => sum + (item.line_total || 0), 0);
      if (Math.abs(itemsTotal - (extraction.amount_total || 0)) > (extraction.amount_total || 0) * 0.005) {
        issues.push(`Sum of line items (${itemsTotal}) differs from total (${extraction.amount_total})`);
      }
    }

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}
