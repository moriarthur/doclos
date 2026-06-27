import { StructuredExtractionService, parseGermanNumber } from './structured-extraction.service';
import { AiService } from './ai.service';

// AiService is never invoked by cleanItems / normalizeExtraction (pure, synchronous),
// so a minimal stub is enough.
const aiStub = { isAvailable: () => true } as unknown as AiService;
const service = new StructuredExtractionService(aiStub);

type RawItem = {
  description?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
  line_total?: number | string | null;
};

describe('parseGermanNumber', () => {
  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['1200,50', 1200.5],
    ['1.200', 1200], // grouped thousands
    ['2', 2],
    ['1.200,00 €', 1200], // currency + space stripped
    ['EUR 49,90', 49.9],
    [2, 2],
    [null, null],
    [undefined, null],
    ['', null],
    ['not-a-number', null],
  ])('parses %p -> %p', (input, expected) => {
    expect(parseGermanNumber(input)).toBe(expected);
  });
});

describe('StructuredExtractionService.cleanItems', () => {
  it('drops summary/totals rows including typo variants', () => {
    const { kept, dropped } = service.cleanItems([
      { description: 'Zwischensumme', line_total: 500 },
      { description: 'Gesamtbetrag', line_total: 595 },
      { description: 'Mehrwertsteuer 19%', line_total: 95 },
      { description: 'Mehrwersteuer', line_total: 95 }, // missing 't'
      { description: 'MwSt.', line_total: 95 },
      { description: 'Mwst 19%', line_total: 95 },
      { description: 'Versandkosten', line_total: 5 },
      { description: 'Rabatt', line_total: 2 },
      { description: 'Endbetrag', line_total: 595 },
      { description: 'Summe', line_total: 500 },
      { description: 'Total', line_total: 595 },
      { description: 'Shipping', line_total: 5 },
    ] as RawItem[]);
    expect(kept).toHaveLength(0);
    expect(dropped.every((d) => d.reason === 'summary')).toBe(true);
  });

  it('does not drop a real item whose name merely contains a summary word mid-sentence', () => {
    // Leading-token match (not includes): a summary word embedded in a product
    // name that does not START with it must survive.
    const { kept } = service.cleanItems([
      { description: 'Versandtaschen 5 Stk', quantity: 5, unit_price: 12, line_total: 60 },
      { description: 'Premium Paket inkl. Versand', quantity: 1, unit_price: 480, line_total: 480 },
    ] as RawItem[]);
    expect(kept).toHaveLength(2);
  });

  it('drops the table header row (>=3 header tokens) but keeps a 2-token description', () => {
    const { kept, dropped } = service.cleanItems([
      { description: 'Pos Beschreibung Menge Einzelpreis Gesamtpreis', quantity: 1, unit_price: 1, line_total: 1 },
      { description: 'Anzahl Einheit', quantity: 2, unit_price: 15, line_total: 30 },
    ] as RawItem[]);
    expect(kept).toHaveLength(1);
    expect(kept[0].description).toBe('Anzahl Einheit');
    expect(dropped.find((d) => d.reason === 'header')).toBeTruthy();
  });

  it('drops hallucinated items that carry no price and no quantity', () => {
    const { kept, dropped } = service.cleanItems([
      { description: 'Siehe Anhang', quantity: null, unit_price: null, line_total: null },
      { description: 'Zahlbar innerhalb 14 Tagen', quantity: null, unit_price: null, line_total: null },
    ] as RawItem[]);
    expect(kept).toHaveLength(0);
    expect(dropped.every((d) => d.reason === 'no-price')).toBe(true);
  });

  it('coerces German-formatted numeric strings then keeps the item', () => {
    const { kept } = service.cleanItems([
      { description: 'Beratung', quantity: '2', unit_price: '1.200,50', line_total: '2.401,00' },
    ] as RawItem[]);
    expect(kept).toHaveLength(1);
    expect(kept[0].quantity).toBe(2);
    expect(kept[0].unit_price).toBe(1200.5);
    expect(kept[0].line_total).toBe(2401);
  });

  it('keeps flat-fee / quantity-zero items that have a line_total', () => {
    const { kept } = service.cleanItems([
      { description: 'Pauschale', quantity: 0, unit_price: 0, line_total: 50 },
    ] as RawItem[]);
    expect(kept).toHaveLength(1);
    expect(kept[0].line_total).toBe(50);
  });

  it('collapses exact duplicates but keeps near-duplicates with different prices', () => {
    const { kept, dropped } = service.cleanItems([
      { description: 'Hosting', quantity: 1, unit_price: 100, line_total: 100 },
      { description: 'Hosting', quantity: 1, unit_price: 100, line_total: 100 }, // exact dupe
      { description: 'Hosting', quantity: 1, unit_price: 100, line_total: 200 }, // different total
    ] as RawItem[]);
    expect(kept).toHaveLength(2);
    expect(dropped.find((d) => d.reason === 'duplicate')).toBeTruthy();
  });

  it('returns an empty result for undefined / [] without throwing', () => {
    expect(service.cleanItems(undefined)).toEqual({ kept: [], dropped: [] });
    expect(service.cleanItems([])).toEqual({ kept: [], dropped: [] });
  });

  it('cleaning a realistic German invoice mix keeps only the real line items', () => {
    const { kept } = service.cleanItems([
      { description: 'Beratung', quantity: 2, unit_price: 100, line_total: 200 },
      { description: 'Hosting', quantity: 1, unit_price: 100, line_total: 100 },
      { description: 'Zwischensumme', quantity: 1, unit_price: 300, line_total: 300 },
      { description: 'MwSt. 19%', quantity: 1, unit_price: 57, line_total: 57 },
      { description: 'Gesamtbetrag', quantity: 1, unit_price: 357, line_total: 357 },
      { description: 'Pos Beschreibung Menge Einzelpreis Gesamtpreis', quantity: 1, unit_price: 1, line_total: 1 },
      { description: 'Siehe beiliegende Unterlagen', quantity: null, unit_price: null, line_total: null },
    ] as RawItem[]);
    expect(kept.map((i) => i.description)).toEqual(['Beratung', 'Hosting']);
  });
});

describe('StructuredExtractionService.normalizeExtraction (integration)', () => {
  it('cleans items as part of normalization', () => {
    const result = service.normalizeExtraction({
      invoice_number: 'RE-2026-001',
      invoice_date: '2026-03-10',
      due_date: null,
      amount_total: 357,
      vat_amount: 57,
      currency: 'eur',
      supplier_name: 'ACME GmbH',
      supplier_address: null,
      items: [
        { description: 'Beratung', quantity: 2, unit_price: 100, line_total: 200 },
        { description: 'Gesamtbetrag', quantity: 1, unit_price: 357, line_total: 357 },
      ],
    });
    expect(result.currency).toBe('EUR'); // sanity: top-level normalization still runs
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0].description).toBe('Beratung');
  });
});
