import { Injectable, Logger } from '@nestjs/common';
import { AiService } from './ai.service';
import {
  INVOICE_EXTRACTION_SYSTEM,
  INVOICE_EXTRACTION_PROMPT,
  PURCHASE_ORDER_EXTRACTION_SYSTEM,
  PURCHASE_ORDER_EXTRACTION_PROMPT,
  OFFER_EXTRACTION_SYSTEM,
  OFFER_EXTRACTION_PROMPT,
  DELIVERY_NOTE_EXTRACTION_SYSTEM,
  DELIVERY_NOTE_EXTRACTION_PROMPT,
  CONTRACT_EXTRACTION_SYSTEM,
  CONTRACT_EXTRACTION_PROMPT,
  CONFIDENCE_ASSESSMENT_PROMPT,
} from '../prompts/extraction.prompts';
import { DocumentType } from '../../documents/entities/document.entity';
import type { LocalizedIssue } from '../../documents/entities/document.entity';

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

// --- S5.1 per-type extraction shapes ---------------------------------------
// Field names mirror the per-type prompts in extraction.prompts.ts. The invoice
// interface above stays the invoice path verbatim; these cover PO / offer /
// delivery_note / contract. The processor maps each onto the shared Invoice +
// invoice_items entities (carrier) and writes the type-specific extras into
// documents.metadata.

/** Shared line-item shape across commercial types (matches InvoiceExtraction.items). */
export interface CommercialItem {
  description: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface PurchaseOrderExtraction {
  po_number: string | null;
  order_date: string | null;
  amount_total: number | null;
  vat_amount: number | null;
  currency: string | null;
  supplier_name: string | null;
  supplier_address: string | null;
  customer_name?: string | null;
  expected_delivery_date?: string | null;
  delivery_terms?: string | null;
  payment_terms?: string | null;
  items?: CommercialItem[];
}

export interface OfferExtraction {
  offer_number: string | null;
  offer_date: string | null;
  amount_total: number | null;
  vat_amount: number | null;
  currency: string | null;
  supplier_name: string | null;
  supplier_address: string | null;
  customer_name?: string | null;
  validity_date?: string | null;
  validity_terms?: string | null;
  items?: CommercialItem[];
}

export interface DeliveryNoteExtraction {
  delivery_note_number: string | null;
  delivery_date: string | null;
  amount_total?: number | null;
  vat_amount?: number | null;
  currency?: string | null;
  supplier_name: string | null;
  supplier_address?: string | null;
  recipient_name?: string | null;
  recipient_address?: string | null;
  order_reference?: string | null;
  items?: CommercialItem[];
}

export interface ContractExtraction {
  seller_name: string | null;
  buyer_name: string | null;
  effective_date: string | null;
  end_date: string | null;
  contract_value: number | null;
  currency: string | null;
  subject: string | null;
  term_description: string | null;
}

export interface ExtractionWithConfidence<T = InvoiceExtraction> {
  data: T;
  confidence: {
    overall: number;
    fields: Record<string, number>;
    /**
     * Bilingual, severity-tagged concerns the model flagged (e.g. anomalous
     * date, unmatched number). Each is `severity: 'review'` — the processor
     * prepends the harder `severity: 'missing'` guard failures separately.
     */
    issues: LocalizedIssue[];
  };
  cost: number;
}

// --- S5.2 metadata sanitization -------------------------------------------
// LLM-extracted (and user-edited) metadata is persisted to JSONB and later
// rendered in the UI / exported to Excel. Sanitize at the persist boundary so
// every consumer is safe by default:
//  - strings: strip HTML tags + control chars, trim, cap length, and strip a
//    leading = + - @ so the value cannot become a spreadsheet formula
//    (CSV/Excel injection) when exported.
//  - numbers: keep only finite numbers; everything else -> null.
//  - objects: recurse; arrays: sanitize each element and drop nulls.
// Pure + idempotent on already-clean data. Exported so the processor (extraction
// persist) and documents.service (user edits) share one implementation.
const MAX_METADATA_STRING_LENGTH = 2000;

function sanitizeString(raw: string): string | null {
  const stripped = raw
    .replace(/<[^>]*>/g, ' ') // HTML tags
    .replace(/[\u0000-\u001F\u007F]/g, ' ') // control chars (incl. DEL)
    .replace(/\s+/g, ' ')
    .trim();
  if (!stripped) return null;
  // Spreadsheet formula injection: a leading = + - @ makes Excel treat the cell
  // as a formula. Strip a leading run of those (plus any residual whitespace).
  const safe = stripped.replace(/^[=+\-@\s]+/, '');
  return safe.length > MAX_METADATA_STRING_LENGTH
    ? safe.slice(0, MAX_METADATA_STRING_LENGTH)
    : safe;
}

/** Sanitize a single metadata value (used by the recursive object walk). */
export function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return sanitizeString(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const v of value) {
      const s = sanitizeMetadataValue(v);
      if (s !== null) out.push(s);
    }
    return out;
  }
  if (typeof value === 'object') {
    return sanitizeMetadata(value as Record<string, unknown>);
  }
  return null;
}

/**
 * Sanitize a metadata object field-by-field. Returns a NEW object; never mutates
 * the input. Keys are also untrusted (LLM output), so they are reduced to plain
 * `[A-Za-z0-9_]` identifiers (capped). Scalar nulls are preserved (an explicit
 * "not found" should survive a reprocess); nested array nulls are dropped.
 */
export function sanitizeMetadata(
  fields: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!fields || typeof fields !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const cleanKey = String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 64);
    if (!cleanKey) continue;
    out[cleanKey] = sanitizeMetadataValue(value);
  }
  return out;
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
   * Shared orchestration for the S5.1 per-type extraction paths: extract a typed
   * JSON object via the LLM, then score field confidence. The invoice path
   * (extractInvoiceData above) keeps its own copy byte-identical and does NOT
   * route through here — that is the behavior-preservation gate.
   */
  private async extractWithConfidence<T>(
    userPrompt: string,
    systemPrompt: string,
    text: string,
    label: string,
  ): Promise<ExtractionWithConfidence<T>> {
    if (!this.aiService.isAvailable()) {
      throw new Error('AI service not available - cannot perform extraction');
    }

    const { data: extraction, usage } = await this.aiService.sendJsonMessage<T>(
      userPrompt,
      systemPrompt,
    );
    const confidence = await this.assessConfidence(extraction, text);
    const cost = this.aiService.estimateCost(usage.inputTokens, usage.outputTokens);

    this.logger.log(
      `${label} extraction complete - Overall confidence: ${confidence.overall.toFixed(2)} (cost: $${cost.toFixed(4)})`,
    );

    return { data: extraction, confidence, cost };
  }

  /** Extract purchase-order data. */
  async extractPurchaseOrderData(
    text: string,
  ): Promise<ExtractionWithConfidence<PurchaseOrderExtraction>> {
    return this.extractWithConfidence<PurchaseOrderExtraction>(
      PURCHASE_ORDER_EXTRACTION_PROMPT(text),
      PURCHASE_ORDER_EXTRACTION_SYSTEM,
      text,
      'Purchase-order',
    );
  }

  /** Extract offer / quote data. */
  async extractOfferData(
    text: string,
  ): Promise<ExtractionWithConfidence<OfferExtraction>> {
    return this.extractWithConfidence<OfferExtraction>(
      OFFER_EXTRACTION_PROMPT(text),
      OFFER_EXTRACTION_SYSTEM,
      text,
      'Offer',
    );
  }

  /** Extract delivery-note data (items usually carry a quantity, not a price). */
  async extractDeliveryNoteData(
    text: string,
  ): Promise<ExtractionWithConfidence<DeliveryNoteExtraction>> {
    return this.extractWithConfidence<DeliveryNoteExtraction>(
      DELIVERY_NOTE_EXTRACTION_PROMPT(text),
      DELIVERY_NOTE_EXTRACTION_SYSTEM,
      text,
      'Delivery-note',
    );
  }

  /** Extract contract data (parties + dates; no items array). */
  async extractContractData(
    text: string,
  ): Promise<ExtractionWithConfidence<ContractExtraction>> {
    return this.extractWithConfidence<ContractExtraction>(
      CONTRACT_EXTRACTION_PROMPT(text),
      CONTRACT_EXTRACTION_SYSTEM,
      text,
      'Contract',
    );
  }

  /**
   * Assess confidence scores for extracted fields
   * @param extraction - Extracted data
   * @param text - Original text for verification
   * @returns Confidence scores
   */
  private async assessConfidence(
    extraction: unknown,
    text: string,
  ): Promise<{ overall: number; fields: Record<string, number>; issues: LocalizedIssue[] }> {
    try {
      const prompt = CONFIDENCE_ASSESSMENT_PROMPT(extraction, text);
      const { data } = await this.aiService.sendJsonMessage<{
        overall_confidence: number;
        field_confidence: Record<string, number>;
        // The prompt requests {de, en} objects, but defend against the model
        // returning plain strings or a single language (see toLocalizedIssues).
        issues: Array<{ de: string; en: string } | string>;
      }>(prompt);

      return {
        overall: data.overall_confidence,
        fields: data.field_confidence,
        issues: this.toLocalizedIssues(data.issues),
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
        issues: [
          {
            severity: 'review',
            message: {
              de: 'Konfidenzbewertung fehlgeschlagen - es wird ein Ersatzwert verwendet',
              en: 'Confidence assessment call failed - using fallback score',
            },
          },
        ],
      };
    }
  }

  /**
   * Coerce the model's confidence `issues` into bilingual LocalizedIssue entries.
   * The prompt asks for `{de, en}` objects, but defend against the model returning
   * plain strings or only one language by mirroring whichever side is present.
   * All model-flagged concerns are soft hints (`severity: 'review'`); the harder
   * `severity: 'missing'` guard failures are produced by the document processor.
   */
  private toLocalizedIssues(
    issues: Array<{ de: string; en: string } | string> | undefined,
  ): LocalizedIssue[] {
    if (!Array.isArray(issues)) return [];
    const out: LocalizedIssue[] = [];
    for (const raw of issues) {
      let de: string;
      let en: string;
      if (typeof raw === 'string') {
        const text = raw.trim();
        if (!text) continue;
        de = en = text;
      } else {
        de = (raw.de ?? '').toString().trim();
        en = (raw.en ?? '').toString().trim();
        if (!de && !en) continue;
        if (!de) de = en;
        if (!en) en = de;
      }
      out.push({ severity: 'review', message: { de, en } });
    }
    return out;
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
    this.normalizeDateFields(normalized, ['invoice_date', 'due_date']);

    // Ensure amounts are numbers. parseGermanNumber also accepts a number and is
    // a no-op for it, so passing the already-numeric common case is safe; for
    // the rare string the German/EU format is handled correctly (unlike the old
    // ad-hoc parseFloat, which mangled "1.200,50" into 1.2005).
    normalized.amount_total = parseGermanNumber(normalized.amount_total);
    normalized.vat_amount = parseGermanNumber(normalized.vat_amount);

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

  // --- S5.1 per-type normalizers -------------------------------------------
  // Each mirrors normalizeExtraction: coerce dates via normalizeDateFields,
  // coerce money via parseGermanNumber, normalize the currency code, and clean
  // line items. PO/offer keep the invoice's strict priced-item rule; delivery
  // notes relax it (quantity without price is a real shipped-goods row).

  normalizePurchaseOrder(extraction: PurchaseOrderExtraction): PurchaseOrderExtraction {
    const normalized = { ...extraction };
    this.normalizeDateFields(normalized, ['order_date', 'expected_delivery_date']);
    normalized.amount_total = parseGermanNumber(normalized.amount_total);
    normalized.vat_amount = parseGermanNumber(normalized.vat_amount);
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }
    normalized.items = this.cleanItems(normalized.items, { requirePrice: true }).kept;
    return normalized;
  }

  normalizeOffer(extraction: OfferExtraction): OfferExtraction {
    const normalized = { ...extraction };
    this.normalizeDateFields(normalized, ['offer_date', 'validity_date']);
    normalized.amount_total = parseGermanNumber(normalized.amount_total);
    normalized.vat_amount = parseGermanNumber(normalized.vat_amount);
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }
    normalized.items = this.cleanItems(normalized.items, { requirePrice: true }).kept;
    return normalized;
  }

  normalizeDeliveryNote(extraction: DeliveryNoteExtraction): DeliveryNoteExtraction {
    const normalized = { ...extraction };
    this.normalizeDateFields(normalized, ['delivery_date']);
    normalized.amount_total = parseGermanNumber(normalized.amount_total);
    normalized.vat_amount = parseGermanNumber(normalized.vat_amount);
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }
    // Delivery-note items usually carry a quantity but no price — relax the
    // no-price drop so genuine shipped-goods rows are kept (carrier stores 0).
    normalized.items = this.cleanItems(normalized.items, { requirePrice: false }).kept;
    return normalized;
  }

  normalizeContract(extraction: ContractExtraction): ContractExtraction {
    const normalized = { ...extraction };
    this.normalizeDateFields(normalized, ['effective_date', 'end_date']);
    normalized.contract_value = parseGermanNumber(normalized.contract_value);
    if (normalized.currency) {
      normalized.currency = normalized.currency.toUpperCase().substring(0, 3);
    }
    return normalized;
  }

  /**
   * Normalize the given date fields of an object in place to ISO format.
   * Extracted from normalizeExtraction so every per-type normalizer shares it.
   * Mirrors the original inline behaviour: only stringified, truthy values are
   * parsed, and a parse failure writes back null (same as the old per-field code).
   */
  private normalizeDateFields<T>(obj: T, fieldNames: Array<keyof T>): void {
    const record = obj as Record<string, unknown>;
    for (const field of fieldNames) {
      const value = record[field as unknown as string];
      if (value && typeof value === 'string') {
        record[field as unknown as string] = this.normalizeDate(value);
      }
    }
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
    options: { requirePrice?: boolean } = {},
  ): { kept: CleanedItem[]; dropped: { reason: string; description: string }[] } {
    const requirePrice = options.requirePrice ?? true;
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

      // 1. No-data rule: a real line item must carry money (price) — or, for
      //    delivery notes where prices are usually absent, at least a quantity.
      //    Quantity-only with no price is normally a header or hallucination, so
      //    requirePrice defaults true; delivery notes opt out.
      const hasPrice =
        (unit_price !== null && unit_price > 0) || (line_total !== null && line_total > 0);
      const hasQuantity = quantity !== null && quantity > 0;
      const qualifies = requirePrice ? hasPrice : hasPrice || hasQuantity;
      if (!qualifies) {
        dropped.push({ reason: requirePrice ? 'no-price' : 'no-data', description: descForLog });
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
      const s = dateStr.trim();

      // German format (D[D].M[M].YYYY) — checked FIRST. `new Date` mis-parses
      // these whenever the day is a valid month ("12.05.2026" → Dec 5), and its
      // toISOString path shifts the day across timezones. Match the dotted
      // groups directly and emit a timezone-neutral YYYY-MM-DD.
      const germanMatch = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
      if (germanMatch) {
        const [, dd, mm, yyyy] = germanMatch;
        return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
      }

      // ISO date (YYYY-MM-DD) — take the date part directly to avoid the same
      // timezone day-shift from toISOString.
      const isoMatch = s.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (isoMatch) {
        return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
      }

      // Fallback: anything Date can parse, day-stable via UTC.
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toISOString().split('T')[0];
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

  /**
   * Per-type correctness guard (S5.1). Returns the bilingual `severity:'missing'`
   * issues for a normalized extraction — the processor routes to NEEDS_VALIDATION
   * when this is non-empty and uses the array directly as the document's
   * extraction_issues guard reasons. Each type enforces only what makes it
   * usable: commercial docs need a number + a positive total + a currency; a
   * delivery note needs at least a number OR a delivery date (prices optional);
   * a contract needs at least a party OR a date.
   *
   * Invoice messages are byte-identical to the previous inline guard in
   * document.processor.ts (behaviour-preservation).
   */
  validateByType(type: DocumentType, extraction: Record<string, unknown>): LocalizedIssue[] {
    const issues: LocalizedIssue[] = [];
    const isMissing = (v: unknown): boolean =>
      v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
    const isBadAmount = (v: unknown): boolean => {
      const n = parseGermanNumber(v);
      return n === null || n <= 0;
    };

    switch (type) {
      case DocumentType.INVOICE:
      case DocumentType.PURCHASE_ORDER:
      case DocumentType.OFFER: {
        const numberKey =
          type === DocumentType.INVOICE
            ? 'invoice_number'
            : type === DocumentType.PURCHASE_ORDER
              ? 'po_number'
              : 'offer_number';
        const numberMessage =
          type === DocumentType.INVOICE
            ? { de: 'Rechnungsnummer fehlt', en: 'Invoice number is missing' }
            : type === DocumentType.PURCHASE_ORDER
              ? { de: 'Bestellnummer fehlt', en: 'Purchase order number is missing' }
              : { de: 'Angebotsnummer fehlt', en: 'Offer number is missing' };

        if (isMissing(extraction['currency'])) {
          issues.push({
            severity: 'missing',
            message: { de: 'Währung fehlt', en: 'Currency is missing' },
          });
        }
        if (isBadAmount(extraction['amount_total'])) {
          issues.push({
            severity: 'missing',
            message: {
              de: 'Gesamtbetrag fehlt oder ist nicht positiv',
              en: 'Total amount is missing or not positive',
            },
          });
        }
        if (isMissing(extraction[numberKey])) {
          issues.push({ severity: 'missing', message: numberMessage });
        }
        break;
      }
      case DocumentType.DELIVERY_NOTE: {
        // Prices are optional on a delivery note — only force validation when we
        // cannot identify the delivery at all (neither number nor date).
        if (
          isMissing(extraction['delivery_note_number']) &&
          isMissing(extraction['delivery_date'])
        ) {
          issues.push({
            severity: 'missing',
            message: {
              de: 'Lieferscheinnummer und Lieferdatum fehlen',
              en: 'Delivery note number and delivery date are missing',
            },
          });
        }
        break;
      }
      case DocumentType.CONTRACT: {
        const hasParty =
          !isMissing(extraction['seller_name']) || !isMissing(extraction['buyer_name']);
        const hasDate =
          !isMissing(extraction['effective_date']) || !isMissing(extraction['end_date']);
        if (!hasParty && !hasDate) {
          issues.push({
            severity: 'missing',
            message: {
              de: 'Keine Vertragspartei und kein Datum erkannt',
              en: 'No contract party and no date recognized',
            },
          });
        }
        break;
      }
      default:
        // UNKNOWN — no extraction, no guard.
        break;
    }

    return issues;
  }
}
