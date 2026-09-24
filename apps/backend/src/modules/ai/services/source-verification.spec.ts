import {
  applySourceVerification,
  UNVERIFIED_FIELD_CONFIDENCE_CAP,
  UNVERIFIED_OVERALL_CAP,
  verifyAmountInSource,
  verifyDateInSource,
  verifyExtractionAgainstSource,
  verifyStringInSource,
} from './source-verification';
import type { LocalizedIssue } from '../../documents/entities/document.entity';

// S4 (audit wave 5): the guard's job is to catch what the assessor missed.
// The hallucinated values below are REAL outputs from the wave-4 A/B runs on
// the scan arm (see AUDIT.md H-3) — keep them as regression fixtures.

// Embedded text of corpus doc invoice_Aaron Bergman_36258.pdf (short enough
// to inline; representative of the invoice layout family).
const TEXT_36258 = `
INVOICE
# 36258
SuperStore
Bill To:
Aaron Bergman
Ship To:
98103, Seattle,
Washington, United
States
Mar 06 2012
First Class
$50.10
Date:
Ship Mode:
Balance Due:
ItemQuantityRateAmount
Global Push Button Manager's Chair, Indigo1$48.71$48.71
Chairs, Furniture, FUR-CH-4421
$48.71
$9.74
$11.13
$50.10
Subtotal:
Discount (20%):
Shipping:
Total:
Notes:
Thanks for your business!
Terms:
Order ID : CA-2012-AB10015140-40974
`;

describe('verifyStringInSource', () => {
  it('verifies values that exist in the text, case- and order-insensitively', () => {
    expect(verifyStringInSource('36258', TEXT_36258)).toBe(true);
    expect(verifyStringInSource('SuperStore', TEXT_36258)).toBe(true);
    expect(verifyStringInSource('superstore', TEXT_36258)).toBe(true);
    expect(verifyStringInSource('Washington United Seattle, States', TEXT_36258)).toBe(true);
  });

  it('rejects the real wave-4 hallucinations', () => {
    expect(verifyStringInSource('Var 08 2012', TEXT_36258)).toBe(false); // 01.jpg invoice_number
    expect(verifyStringInSource('IC SA 201; JD8150110 41087', TEXT_36258)).toBe(false); // 08.jpg
    expect(verifyStringInSource('CR125801144 21132', TEXT_36258)).toBe(false); // 05.jpg, real + appended junk
  });

  it('rejects empty/blank values', () => {
    expect(verifyStringInSource('', TEXT_36258)).toBe(false);
    expect(verifyStringInSource('  ', TEXT_36258)).toBe(false);
  });
});

describe('verifyAmountInSource', () => {
  it('matches across currency symbols and thousands formatting', () => {
    expect(verifyAmountInSource(50.1, TEXT_36258)).toBe(true); // "$50.10"
    expect(verifyAmountInSource(7115.53, 'Balance Due:\n$7,115.53\nTotal:')).toBe(true);
  });

  it('handles the German number format (P1-2 normalizer) — no P1-2 regression', () => {
    expect(verifyAmountInSource(1234.56, 'Gesamtbetrag: 1.234,56 EUR')).toBe(true);
    expect(verifyAmountInSource(123456, 'Gesamtbetrag: 1.234,56 EUR')).toBe(false);
  });

  it('rejects amounts that appear under no formatting', () => {
    expect(verifyAmountInSource(999.99, TEXT_36258)).toBe(false);
  });
});

describe('verifyDateInSource', () => {
  it('finds the English "Mon DD YYYY" corpus format', () => {
    expect(verifyDateInSource('2012-03-06', TEXT_36258)).toBe(true);
  });

  it('finds "Jun 5, 2023" style (degenerate corpus doc)', () => {
    expect(verifyDateInSource('2023-06-05', 'Bill To:\nJun 5, 2023\n$0.00')).toBe(true);
  });

  it('finds the German dotted format', () => {
    expect(verifyDateInSource('2012-03-06', 'Rechnungsdatum: 06.03.2012')).toBe(true);
  });

  it('rejects dates that appear in no written form', () => {
    expect(verifyDateInSource('2011-03-06', TEXT_36258)).toBe(false);
    expect(verifyDateInSource('not-a-date', TEXT_36258)).toBe(false);
  });
});

describe('verifyExtractionAgainstSource', () => {
  const good = {
    invoice_number: '36258',
    invoice_date: '2012-03-06',
    due_date: null,
    amount_total: 50.1,
    vat_amount: null,
    currency: 'USD',
    supplier_name: 'SuperStore',
    supplier_address: null,
  };

  it('passes a faithful extraction with no cap and no issues', () => {
    const r = verifyExtractionAgainstSource('INVOICE', good, TEXT_36258);
    expect(Object.values(r.verified).every(Boolean)).toBe(true);
    expect(r.overallCap).toBeNull();
    expect(r.issues).toEqual([]);
    expect(r.cappedConfidences).toEqual({});
  });

  it('flags a hallucinated invoice_number (the 01.jpg failure mode)', () => {
    const r = verifyExtractionAgainstSource(
      'INVOICE',
      { ...good, invoice_number: 'Var 08 2012' },
      TEXT_36258,
    );
    expect(r.verified['invoice_number']).toBe(false);
    expect(r.cappedConfidences['invoice_number']).toBe(UNVERIFIED_FIELD_CONFIDENCE_CAP);
    expect(r.overallCap).toBe(UNVERIFIED_OVERALL_CAP);
    expect(r.issues).toHaveLength(1);
    expect(r.issues[0].severity).toBe('review');
    expect(r.issues[0].message.en).toContain('invoice_number');
  });

  it('skips null fields (missing values are validateByType’s job)', () => {
    const r = verifyExtractionAgainstSource('INVOICE', { ...good, due_date: null }, TEXT_36258);
    expect(r.verified['due_date']).toBeUndefined();
  });

  it('guards nothing for an unsupported type key', () => {
    const r = verifyExtractionAgainstSource('UNKNOWN', good, TEXT_36258);
    expect(r.overallCap).toBeNull();
    expect(Object.keys(r.verified)).toHaveLength(0);
  });
});

describe('applySourceVerification', () => {
  it('the assessor cannot raise a field the guard failed', () => {
    const confidence = {
      overall: 0.92,
      fields: { invoice_number: 1.0, amount_total: 0.9 },
      issues: [{ severity: 'review', message: { de: 'x', en: 'x' } }] as LocalizedIssue[],
    };
    const verification = verifyExtractionAgainstSource(
      'INVOICE',
      { invoice_number: 'Var 08 2012', amount_total: 50.1, supplier_name: 'SuperStore', invoice_date: '2012-03-06' },
      TEXT_36258,
    );
    applySourceVerification(confidence, verification);
    expect(confidence.fields['invoice_number']).toBe(UNVERIFIED_FIELD_CONFIDENCE_CAP); // was 1.0
    expect(confidence.fields['amount_total']).toBe(0.9); // verified — untouched
    expect(confidence.overall).toBe(UNVERIFIED_OVERALL_CAP); // was 0.92
    expect(confidence.issues[0]).toBe(verification.issues[0]); // guard issues first
    expect(confidence.issues).toHaveLength(2);
  });

  it('leaves a fully-verified extraction alone', () => {
    const confidence = { overall: 0.92, fields: { invoice_number: 0.95 }, issues: [] };
    const verification = verifyExtractionAgainstSource(
      'INVOICE',
      { invoice_number: '36258', amount_total: 50.1 },
      TEXT_36258,
    );
    applySourceVerification(confidence, verification);
    expect(confidence.overall).toBe(0.92);
    expect(confidence.fields['invoice_number']).toBe(0.95);
    expect(confidence.issues).toEqual([]);
  });
});
