// P1-1 / P1-2 regression tests (audit review acceptance): German-formatted
// dates and amounts must survive normalization. Exercises the private
// normalizeDate/parseAmount through the public normalizeExtraction.
import { StructuredExtractionService } from './structured-extraction.service';

describe('StructuredExtractionService normalization (P1-1 / P1-2)', () => {
  // normalizeDate/parseAmount are pure — the AI dependency is never touched.
  // Input is loosely typed on purpose: real LLM output arrives as raw JSON
  // where dates/amounts are strings, which is exactly what the code normalizes.
  const service = new StructuredExtractionService({} as any);
  const normalize = (fields: Record<string, unknown>) =>
    service.normalizeExtraction(fields as any);

  describe('P1-1 normalizeDate (German DD.MM.YYYY before new Date)', () => {
    it('parses 03.04.2026 as 3 April (not March 4)', () => {
      expect(normalize({ invoice_date: '03.04.2026' }).invoice_date).toBe('2026-04-03');
    });

    it('parses 25.12.2026 as 25 December', () => {
      expect(normalize({ due_date: '25.12.2026' }).due_date).toBe('2026-12-25');
    });

    it('keeps strict ISO input unchanged', () => {
      expect(normalize({ invoice_date: '2026-04-03' }).invoice_date).toBe('2026-04-03');
    });

    it('returns null for unparseable formats instead of guessing', () => {
      expect(normalize({ invoice_date: '03/04/2026' }).invoice_date).toBeNull();
    });
  });

  describe('P1-2 parseAmount (German decimal formats)', () => {
    it('parses thousands-separated German format: 1.200,50 -> 1200.5', () => {
      expect(normalize({ amount_total: '1.200,50' }).amount_total).toBe(1200.5);
    });

    it('parses German decimal comma: 1200,50 -> 1200.5', () => {
      expect(normalize({ amount_total: '1200,50' }).amount_total).toBe(1200.5);
    });

    it('parses currency-prefixed plain format: €1200.50 -> 1200.5', () => {
      expect(normalize({ amount_total: '€1200.50' }).amount_total).toBe(1200.5);
    });

    it('parses US format via fallback: 1,200.50 -> 1200.5', () => {
      expect(normalize({ amount_total: '1,200.50' }).amount_total).toBe(1200.5);
    });

    it('keeps vat_amount on the same path', () => {
      expect(normalize({ vat_amount: '19,99' }).vat_amount).toBe(19.99);
    });
  });
});
