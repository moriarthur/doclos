import { DocumentType } from '../../documents/entities/document.entity';
import type { LocalizedIssue } from '../../documents/entities/document.entity';
import { parseGermanNumber } from './structured-extraction.service';

// S4 (audit wave 5): deterministic source-verification guard.
//
// The confidence assessor is unreliable on scanned documents — it rewarded a
// hallucinated invoice_number with 1.0 while the value appears nowhere in the
// OCR text (wave-4 A/B, 01.jpg). This guard is the mechanical backstop: every
// extracted value must be (fuzzily) findable in the OCR text it claims to come
// from. Values that cannot be found get their confidence capped and the
// document is kept out of auto-accept. Pure functions, no LLM — cheap, and it
// cannot be fooled the way a prompt can.

/** Confidence written to an extracted field the guard could not find in the source text. */
export const UNVERIFIED_FIELD_CONFIDENCE_CAP = 0.5;
/** Overall-confidence ceiling while any guarded field is unverified (blocks the 0.85 auto-accept). */
export const UNVERIFIED_OVERALL_CAP = 0.8;

export interface SourceVerificationResult {
  /** Guarded field name -> true when the value was found in the source text. */
  verified: Record<string, boolean>;
  /** Bilingual `review` issues, one per unverified field. */
  issues: LocalizedIssue[];
  /** Guarded field name -> capped confidence to enforce AFTER the assessor runs. */
  cappedConfidences: Record<string, number>;
  /** Ceiling for the overall confidence, or null when everything verified. */
  overallCap: number | null;
}

/** Lowercase and collapse whitespace/separator noise for token-free comparisons. */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‐-―−]/g, '-') // unicode dashes
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Alphanumeric tokens of a string; single characters are noise for our purposes. */
function tokens(s: string): string[] {
  return normalizeForMatch(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * A string value is verified when every significant token of it appears as a
 * token in the source text. Order-insensitive, so OCR line breaks inside an
 * address don't hurt; whole-token matching, so a hallucinated appended number
 * ("CR125801144 21132") still fails because "21132" is nowhere in the text.
 */
export function verifyStringInSource(value: string, text: string): boolean {
  const valueTokens = tokens(value);
  if (valueTokens.length === 0) return false;
  const textTokenSet = new Set(tokens(text));
  return valueTokens.every((t) => textTokenSet.has(t));
}

/**
 * Amounts are verified numerically: parse every money-like run in the source
 * text with the same P1-2 German/EN normalizer the extraction uses, and accept
 * when any parsed number matches within a cent. Formatting differences
 * ("$7,115.53" vs 7115.53, "1.234,56" vs 1234.56) therefore never fail the
 * guard — only a value that appears under no formatting does.
 */
export function verifyAmountInSource(amount: number, text: string): boolean {
  if (!Number.isFinite(amount)) return false;
  const runs = text.match(/(?:[$€£]\s*)?\d[\d.,]*/g) ?? [];
  for (const run of runs) {
    const parsed = parseGermanNumber(run);
    if (parsed !== null && Math.abs(parsed - amount) < 0.01) return true;
  }
  return false;
}

/**
 * Dates are verified by generating the plausible written forms of the ISO date
 * and looking for any of them in the text: ISO, German dotted, and the English
 * "Mar 06 2012" / "Jun 5, 2023" shapes used by the sample corpus.
 */
export function verifyDateInSource(isoDate: string, text: string): boolean {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false; // not even ISO — nothing verifiable to look for
  const [, yyyy, mm, dd] = m;
  const day = String(Number(dd));
  const haystack = normalizeForMatch(text);
  const dotted = `${dd}.${mm}.${yyyy}`;
  const iso = `${yyyy}-${mm}-${dd}`;
  const usShort = `${dd}/${mm}/${yyyy}`;
  if (haystack.includes(dotted) || haystack.includes(iso) || haystack.includes(usShort)) {
    return true;
  }
  // "Mar 06 2012" / "Jun 5, 2023" — month names, any capitalization.
  const months = [
    'jan', 'feb', 'mar', 'apr', 'may', 'jun',
    'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  ];
  const monthName = months[Number(mm) - 1];
  if (monthName) {
    // "Mar 06 2012" and "Jun 5, 2023" — zero-padded or bare day.
    const re = new RegExp(`${monthName}\\w*\\s+0?${day},?\\s+${yyyy}`);
    if (re.test(haystack)) return true;
  }
  // Last resort: day and month and year all present as standalone numbers is
  // TOO loose — skip. An unmatched date stays unverified and routes to review.
  return false;
}

/** Guarded fields per document type — keyed by the DocumentType VALUE
 * ('invoice', …), which is what call sites pass (the processor receives the
 * enum value, not its name). */
const GUARDED_FIELDS: Record<string, Array<{ field: string; kind: 'string' | 'date' | 'amount' }>> = {
  [DocumentType.INVOICE]: [
    { field: 'invoice_number', kind: 'string' },
    { field: 'invoice_date', kind: 'date' },
    { field: 'due_date', kind: 'date' },
    { field: 'amount_total', kind: 'amount' },
    { field: 'vat_amount', kind: 'amount' },
    { field: 'supplier_name', kind: 'string' },
    { field: 'supplier_address', kind: 'string' },
  ],
  [DocumentType.PURCHASE_ORDER]: [
    { field: 'po_number', kind: 'string' },
    { field: 'order_date', kind: 'date' },
    { field: 'expected_delivery_date', kind: 'date' },
    { field: 'amount_total', kind: 'amount' },
    { field: 'supplier_name', kind: 'string' },
    { field: 'supplier_address', kind: 'string' },
  ],
  [DocumentType.OFFER]: [
    { field: 'offer_number', kind: 'string' },
    { field: 'offer_date', kind: 'date' },
    { field: 'validity_date', kind: 'date' },
    { field: 'amount_total', kind: 'amount' },
    { field: 'supplier_name', kind: 'string' },
    { field: 'supplier_address', kind: 'string' },
  ],
  [DocumentType.DELIVERY_NOTE]: [
    { field: 'delivery_note_number', kind: 'string' },
    { field: 'delivery_date', kind: 'date' },
    { field: 'supplier_name', kind: 'string' },
  ],
  [DocumentType.CONTRACT]: [
    { field: 'seller_name', kind: 'string' },
    { field: 'buyer_name', kind: 'string' },
    { field: 'effective_date', kind: 'date' },
    { field: 'end_date', kind: 'date' },
    { field: 'contract_value', kind: 'amount' },
  ],
};

/**
 * Verify a normalized extraction against the OCR text it came from. Only
 * non-null values are checked (a missing field is the validateByType guard's
 * job). Known scope limit: a value that exists in the text but is the WRONG
 * value for the field (e.g. the Order ID picked as invoice_number) verifies
 * fine — catching that needs semantic checks, which stay with the assessor.
 */
export function verifyExtractionAgainstSource(
  type: string,
  extraction: Record<string, unknown>,
  text: string,
): SourceVerificationResult {
  const result: SourceVerificationResult = {
    verified: {},
    issues: [],
    cappedConfidences: {},
    overallCap: null,
  };

  for (const { field, kind } of GUARDED_FIELDS[type] ?? []) {
    const value = extraction[field];
    if (value === null || value === undefined || value === '') continue;

    let verified: boolean;
    if (kind === 'amount') {
      const n = typeof value === 'number' ? value : parseGermanNumber(value);
      verified = n !== null && verifyAmountInSource(n, text);
    } else if (kind === 'date') {
      verified = typeof value === 'string' && verifyDateInSource(value, text);
    } else {
      verified = typeof value === 'string' && verifyStringInSource(value, text);
    }

    result.verified[field] = verified;
    if (!verified) {
      result.cappedConfidences[field] = UNVERIFIED_FIELD_CONFIDENCE_CAP;
      result.issues.push({
        severity: 'review',
        message: {
          de: `"${field}": Wert nicht im Dokumenttext gefunden — mögliche Fehlinterpretation, bitte prüfen`,
          en: `"${field}": value not found in the document text — possible misread, please review`,
        },
      });
    }
  }

  if (Object.values(result.verified).some((v) => !v)) {
    result.overallCap = UNVERIFIED_OVERALL_CAP;
  }
  return result;
}

/**
 * Apply a verification result to the confidence object produced by the
 * assessor: capped fields can never exceed their cap (the assessor cannot
 * raise a field the guard failed), and the overall score is clamped to the
 * overall cap while anything is unverified. Mutates `confidence` in place —
 * it is created per-request by the extraction path.
 */
export function applySourceVerification(
  confidence: { overall: number; fields: Record<string, number>; issues: LocalizedIssue[] },
  verification: SourceVerificationResult,
): void {
  for (const [field, cap] of Object.entries(verification.cappedConfidences)) {
    confidence.fields[field] = Math.min(confidence.fields[field] ?? 1, cap);
  }
  if (verification.overallCap !== null) {
    confidence.overall = Math.min(confidence.overall, verification.overallCap);
  }
  confidence.issues = [...verification.issues, ...(confidence.issues ?? [])];
}
