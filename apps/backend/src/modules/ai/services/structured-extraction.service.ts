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
    /** Human-readable concerns the model flagged (e.g. anomalous date). */
    issues: string[];
  };
  cost: number;
}

// Part 3: Line-item cleanup — drop summary rows, table headers, hallucinated
// no-data rows, and exact duplicates that GLM over-extracts from German/EU invoices.

/** A raw item as the LLM may return it (numbers may arrive as German-formatted strings). */
interface RawItem {
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  line_total?: number | string | null;
}

/** A cleaned item with coerced numeric fields. */
interface CleanedItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

/**
 * Parse a German/EU formatted number into a number.
 * Handles "1.234,56" -> 1234.56, "1,234.56" -> 1234.56, "1200,50" -> 1200.5,
 * "1.200" -> 1200 (grouped thousands), and strips currency symbols / spaces.
 * Returns null when there is no parseable number.
 * (Corrects the comma-decimal case the top-level amount coercion does not handle.)
 */
export function parseGermanNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  let s = value.trim().replace(/[^0-9.,-]/g, '');
  if (!s) return null;

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // The last separator is the decimal separator; the other is a thousands grouping.
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Comma only: decimal if 1-2 trailing digits, else thousands grouping.
    if (/,\d{1,2}$/.test(s)) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasDot) {
    // Dot only: treat grouped 3-digit blocks as thousands ("1.200" -> 1200).
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

// Description is treated as a summary row if it is exactly or starts with one of
// these terms at a token boundary (anchored leading-token match, NOT includes —
// so "Versandtaschen 5 Stk" survives while "Versandkosten" is dropped).
const SUMMARY_PATTERN_SOURCES = [
  '^(zwischen|gesamt|end)?summe\\b',
  '^(gesamt|end|rechnungs)?betrag\\b',
  '^mehrwer(t|ts)?steuer\\b',
  '^mwst\\b\\.?',
  '^(ust|umsatzsteuer)\\b',
  '^versand(kosten)?\\b',
  '^porto\\b',
  '^rabatt\\b',
  '^skonto\\b',
  '^discount\\b',
  '^shipping\\b',
  '^subtotal\\b',
  '^(vat|tax)\\b',
  '^total\\b',
  '^gutschrift\\b',
  '^zahl(betrag|ungsbetrag)\\b',
  '^(netto|brutto)\\b',
];

/** Compiled, case-insensitive. Applied against the normalized (lowercased) description. */
export const SUMMARY_ROW_PATTERNS: readonly RegExp[] = SUMMARY_PATTERN_SOURCES.map(
  (src) => new RegExp(src, 'i'),
);

// A row is the table header if it contains >=3 of these as whole words.
// (3, not 2: "Total Price" legitimately appears in real item descriptions.)
export const HEADER_TOKENS: readonly string[] = [
  'pos', 'position', 'beschreibung', 'bezeichnung', 'artikel', 'menge', 'anzahl',
  'einheit', 'einzelpreis', 'ep', 'gesamtpreis', 'gp', 'preis', 'betrag',
  'description', 'qty', 'quantity', 'unit', 'price', 'total', 'amount',
];

const HEADER_TOKEN_REGEXES: readonly RegExp[] = HEADER_TOKENS.map((tok) => {
  const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`);
});

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
  ): Promise<{ overall: number; fields: Record<string, number>; issues: string[] }> {
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
        issues: Array.isArray(data.issues) ? data.issues.map(String) : [],
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
        issues: ['Confidence assessment call failed — using fallback score'],
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

    // Ensure amounts are numbers
    if (normalized.amount_total && typeof normalized.amount_total === 'string') {
      const amountStr = normalized.amount_total as string;
      normalized.amount_total = parseFloat(amountStr.replace(/[^\d.-]/g, ''));
    }
    if (normalized.vat_amount && typeof normalized.vat_amount === 'string') {
      const vatStr = normalized.vat_amount as string;
      normalized.vat_amount = parseFloat(vatStr.replace(/[^\d.-]/g, ''));
    }

    // Validate currency code
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }

    // Clean line items: drop summary rows, table headers, hallucinated no-data
    // rows, and exact duplicates. Runs before persistence and before confidence
    // scoring. Items are read-only to the client, so this never clobbers edits.
    normalized.items = this.cleanItems(normalized.items).kept;

    return normalized;
  }

  /**
   * Clean extracted line items — removes the over-extracted junk GLM tends to
   * produce for German/EU invoices (summary/totals rows, table header, rows
   * with no price, exact duplicates).
   * Pure function: safe to unit-test via normalizeExtraction.
   * @returns kept items (with coerced numbers) + dropped entries (for logging)
   */
  cleanItems(
    items: RawItem[] | undefined | null,
  ): { kept: CleanedItem[]; dropped: { reason: string; description: string }[] } {
    if (!items || !Array.isArray(items) || items.length === 0) {
      return { kept: [], dropped: [] };
    }

    const dropped: { reason: string; description: string }[] = [];
    const seen = new Set<string>();
    const kept: CleanedItem[] = [];

    for (const raw of items) {
      const description = ((raw?.description as string | null | undefined) ?? '').toString().trim();
      const normalizedDesc = description.toLowerCase().replace(/\s+/g, ' ').trim();
      const descForLog = description || '(empty)';

      const quantity = parseGermanNumber(raw?.quantity);
      const unit_price = parseGermanNumber(raw?.unit_price);
      const line_total = parseGermanNumber(raw?.line_total);

      // 1. No-data rule: a real line item must carry money. Quantity alone (no
      //    price) is almost always a header or hallucination.
      const hasPrice =
        (unit_price !== null && unit_price > 0) || (line_total !== null && line_total > 0);
      if (!hasPrice) {
        dropped.push({ reason: 'no-price', description: descForLog });
        continue;
      }

      // 2. Header rule: >=3 column-header tokens.
      const headerHits = HEADER_TOKEN_REGEXES.filter((re) => re.test(normalizedDesc)).length;
      if (headerHits >= 3) {
        dropped.push({ reason: 'header', description: descForLog });
        continue;
      }

      // 3. Summary rule: leading-token match against totals/tax/shipping terms.
      if (normalizedDesc && SUMMARY_ROW_PATTERNS.some((re) => re.test(normalizedDesc))) {
        dropped.push({ reason: 'summary', description: descForLog });
        continue;
      }

      // 4. Dedup: collapse exact duplicates (same description + same numbers).
      const key = `${normalizedDesc}|${quantity}|${unit_price}|${line_total}`;
      if (seen.has(key)) {
        dropped.push({ reason: 'duplicate', description: descForLog });
        continue;
      }
      seen.add(key);

      kept.push({
        description,
        quantity: quantity ?? 0,
        unit_price: unit_price ?? 0,
        line_total: line_total ?? 0,
      });
    }

    this.logger.debug(
      `Items cleaned: ${dropped.length} dropped (${this.summarizeDropped(dropped)}), ${kept.length} kept`,
    );
    // Suspicious: more dropped than kept. Flag so a misfired rule is greppable
    // during verification (a legit item being eaten would show up here).
    if (kept.length > 0 && dropped.length > kept.length) {
      this.logger.warn(
        `Items cleaning dropped more rows (${dropped.length}) than kept (${kept.length}) — verify no legitimate items were removed`,
      );
    }

    return { kept, dropped };
  }

  private summarizeDropped(dropped: { reason: string }[]): string {
    const counts: Record<string, number> = {};
    for (const d of dropped) counts[d.reason] = (counts[d.reason] ?? 0) + 1;
    return Object.entries(counts)
      .map(([reason, count]) => `${reason}:${count}`)
      .join(', ');
  }

  /**
   * Normalize date to ISO format
   * Handles German date format (DD.MM.YYYY)
   * @param dateStr - Date string
   * @returns ISO date string or null
   */
  private normalizeDate(dateStr: string): string | null {
    try {
      // Try parsing as ISO
      const isoDate = new Date(dateStr);
      if (!isNaN(isoDate.getTime())) {
        return isoDate.toISOString().split('T')[0];
      }

      // Try German format (DD.MM.YYYY)
      const germanMatch = dateStr.match(/(\d{2})\.(\d{2})\.(\d{4})/);
      if (germanMatch) {
        const [, day, month, year] = germanMatch;
        return `${year}-${month}-${day}`;
      }

      return null;
    } catch {
      return null;
    }
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

    // NOTE: the previous sum(line_items) vs amount_total check was removed.
    // EU invoices carry netto line items but a brutto amount_total, and cleanItems
    // strips the VAT/total summary rows, so the two are structurally ~19% apart by
    // design — the check false-positived on essentially every invoice at any
    // threshold. Duplicate-driven inflation is already handled by cleanItems dedup.

    return {
      isValid: issues.length === 0,
      issues,
    };
  }
}
