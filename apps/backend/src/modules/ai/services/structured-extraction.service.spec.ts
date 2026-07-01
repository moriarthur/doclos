import { StructuredExtractionService, parseGermanNumber, sanitizeMetadata } from './structured-extraction.service';
import { AiService } from './ai.service';
import { DocumentType } from '../../documents/entities/document.entity';

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

// --- S5.1 document-types ---------------------------------------------------

describe('StructuredExtractionService.cleanItems (delivery-note mode)', () => {
  it('keeps a quantity-only item (no price) when requirePrice is false', () => {
    const { kept } = service.cleanItems(
      [
        { description: 'Schrauben M8', quantity: 200, unit_price: null, line_total: null },
        { description: 'Dichtung', quantity: 5 },
      ],
      { requirePrice: false },
    );
    expect(kept).toHaveLength(2);
    expect(kept[0].quantity).toBe(200);
    expect(kept[0].unit_price).toBe(0); // absent price coerced to 0 (carrier default)
    expect(kept[1].quantity).toBe(5);
  });

  it('still drops rows with neither quantity nor price when requirePrice is false', () => {
    const { kept, dropped } = service.cleanItems(
      [{ description: 'Siehe Anhang', quantity: null, unit_price: null, line_total: null }],
      { requirePrice: false },
    );
    expect(kept).toHaveLength(0);
    expect(dropped[0].reason).toBe('no-data');
  });

  it('still applies summary/header/dedup rules in delivery-note mode', () => {
    const { kept, dropped } = service.cleanItems(
      [
        { description: 'Gesamtbetrag', quantity: 1, line_total: 595 },
        { description: 'Pos Beschreibung Menge Einzelpreis Gesamtpreis', quantity: 1, line_total: 1 },
        { description: 'Bretter', quantity: 10 },
        { description: 'Bretter', quantity: 10 },
      ],
      { requirePrice: false },
    );
    expect(kept).toHaveLength(1);
    expect(kept[0].description).toBe('Bretter');
    expect(dropped.map((d) => d.reason).sort()).toEqual(['duplicate', 'header', 'summary']);
  });
});

describe('StructuredExtractionService per-type normalization', () => {
  it('normalizePurchaseOrder coerces German money/dates and cleans items', () => {
    const result = service.normalizePurchaseOrder({
      po_number: 'PO-2026-017',
      order_date: '2026-03-10',
      amount_total: '1.200,50' as unknown as number,
      vat_amount: '228,10' as unknown as number,
      currency: 'eur',
      supplier_name: 'ACME GmbH',
      supplier_address: null,
      expected_delivery_date: '15.03.2026',
      items: [
        { description: 'Widget', quantity: 2, unit_price: '500,25', line_total: '1000,50' },
        { description: 'Gesamtbetrag', quantity: 1, unit_price: 1200, line_total: 1200 },
      ] as any,
    });
    expect(result.amount_total).toBe(1200.5);
    expect(result.vat_amount).toBe(228.1);
    expect(result.currency).toBe('EUR');
    expect(result.order_date).toBe('2026-03-10');
    expect(result.expected_delivery_date).toBe('2026-03-15');
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0].unit_price).toBe(500.25);
  });

  it('normalizeOffer upper-cases currency and keeps priced items only', () => {
    const result = service.normalizeOffer({
      offer_number: 'AN-2026-031',
      offer_date: '01.04.2026',
      amount_total: 990,
      vat_amount: null,
      currency: 'gbp',
      supplier_name: 'Ltd Co',
      supplier_address: null,
      validity_date: '30.04.2026',
      items: [{ description: 'Service', quantity: 1, unit_price: 990, line_total: 990 }],
    });
    expect(result.currency).toBe('GBP');
    expect(result.offer_date).toBe('2026-04-01');
    expect(result.validity_date).toBe('2026-04-30');
    expect(result.items).toHaveLength(1);
  });

  it('normalizeDeliveryNote keeps quantity-only items (no price)', () => {
    const result = service.normalizeDeliveryNote({
      delivery_note_number: 'LS-2026-008',
      delivery_date: '12.05.2026',
      amount_total: null,
      vat_amount: null,
      currency: null,
      supplier_name: 'Logistik GmbH',
      supplier_address: null,
      items: [
        { description: 'Paletten', quantity: 4, unit_price: null, line_total: null },
        { description: 'Siehe Lieferschein', quantity: null, unit_price: null, line_total: null },
      ] as any,
    });
    expect(result.delivery_date).toBe('2026-05-12');
    expect(result.items).toHaveLength(1);
    expect(result.items?.[0].quantity).toBe(4);
    expect(result.items?.[0].unit_price).toBe(0); // absent price coerced to 0
  });

  it('normalizeContract coerces value and dates, carries no items', () => {
    const result = service.normalizeContract({
      seller_name: 'IT Service GmbH',
      buyer_name: 'Kunde AG',
      effective_date: '01.01.2026',
      end_date: '31.12.2026',
      contract_value: '24.000,00' as unknown as number,
      currency: 'eur',
      subject: 'Wartung',
      term_description: '12 Monate',
    });
    expect(result.contract_value).toBe(24000);
    expect(result.currency).toBe('EUR');
    expect(result.effective_date).toBe('2026-01-01');
    expect(result.end_date).toBe('2026-12-31');
  });
});

describe('StructuredExtractionService.validateByType', () => {
  it('invoice: reports missing currency, amount, and number (in that order)', () => {
    const issues = service.validateByType(DocumentType.INVOICE, {
      invoice_number: '',
      amount_total: 0,
      currency: null,
    });
    expect(issues).toHaveLength(3);
    expect(issues.every((i) => i.severity === 'missing')).toBe(true);
    expect(issues.map((i) => i.message.en)).toEqual([
      'Currency is missing',
      'Total amount is missing or not positive',
      'Invoice number is missing',
    ]);
  });

  it('invoice: no issues when number, positive amount, and currency are present', () => {
    expect(
      service.validateByType(DocumentType.INVOICE, {
        invoice_number: 'RE-1',
        amount_total: 100,
        currency: 'EUR',
      }),
    ).toEqual([]);
  });

  it('purchase_order: reports missing po_number and amount, skips currency when present', () => {
    const messages = service
      .validateByType(DocumentType.PURCHASE_ORDER, {
        po_number: null,
        amount_total: null,
        currency: 'EUR',
      })
      .map((i) => i.message.en);
    expect(messages).toContain('Purchase order number is missing');
    expect(messages).toContain('Total amount is missing or not positive');
    expect(messages).not.toContain('Currency is missing');
  });

  it('offer: reports missing offer number', () => {
    const messages = service
      .validateByType(DocumentType.OFFER, {
        offer_number: null,
        amount_total: 50,
        currency: 'EUR',
      })
      .map((i) => i.message.en);
    expect(messages).toEqual(['Offer number is missing']);
  });

  it('delivery_note: no issue when only the number is present (price optional)', () => {
    expect(
      service.validateByType(DocumentType.DELIVERY_NOTE, {
        delivery_note_number: 'LS-1',
        delivery_date: null,
        amount_total: null,
        currency: null,
      }),
    ).toEqual([]);
  });

  it('delivery_note: no issue when only the date is present', () => {
    expect(
      service.validateByType(DocumentType.DELIVERY_NOTE, {
        delivery_note_number: null,
        delivery_date: '2026-05-12',
      }),
    ).toEqual([]);
  });

  it('delivery_note: issue only when BOTH number and date are missing', () => {
    const issues = service.validateByType(DocumentType.DELIVERY_NOTE, {
      delivery_note_number: null,
      delivery_date: null,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message.en).toBe('Delivery note number and delivery date are missing');
  });

  it('contract: no issue when at least one party is present', () => {
    expect(
      service.validateByType(DocumentType.CONTRACT, {
        seller_name: 'A',
        buyer_name: null,
        effective_date: null,
        end_date: null,
      }),
    ).toEqual([]);
  });

  it('contract: no issue when at least one date is present', () => {
    expect(
      service.validateByType(DocumentType.CONTRACT, {
        seller_name: null,
        buyer_name: null,
        effective_date: '2026-01-01',
        end_date: null,
      }),
    ).toEqual([]);
  });

  it('contract: issue when no party AND no date', () => {
    const issues = service.validateByType(DocumentType.CONTRACT, {
      seller_name: null,
      buyer_name: null,
      effective_date: null,
      end_date: null,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message.en).toBe('No contract party and no date recognized');
  });

  it('unknown: never produces issues', () => {
    expect(service.validateByType(DocumentType.UNKNOWN, {})).toEqual([]);
  });
});

describe('sanitizeMetadata', () => {
  it('strips HTML tags and collapses whitespace', () => {
    expect(sanitizeMetadata({ subject: 'Wartung <script>alert(1)</script> IT' })?.subject).toBe('Wartung alert(1) IT');
  });

  it('strips a leading formula trigger (= + - @) to prevent CSV/Excel injection', () => {
    expect(sanitizeMetadata({ a: '=CMD("calc")' })?.a).toBe('CMD("calc")');
    expect(sanitizeMetadata({ b: '+1+1' })?.b).toBe('1+1');
    expect(sanitizeMetadata({ c: '@SUM(A1)' })?.c).toBe('SUM(A1)');
  });

  it('caps string length at 2000 chars', () => {
    const out = sanitizeMetadata({ subject: 'a'.repeat(3000) })?.subject as string;
    expect(out.length).toBe(2000);
  });

  it('keeps finite numbers, drops NaN/Infinity', () => {
    expect(sanitizeMetadata({ contract_value: 24000 })?.contract_value).toBe(24000);
    expect(sanitizeMetadata({ bad: NaN })?.bad).toBeNull();
    expect(sanitizeMetadata({ inf: Infinity })?.inf).toBeNull();
  });

  it('keeps ISO date strings intact', () => {
    expect(sanitizeMetadata({ effective_date: '2026-01-01' })?.effective_date).toBe('2026-01-01');
  });

  it('keeps booleans', () => {
    expect(sanitizeMetadata({ flag: true })?.flag).toBe(true);
  });

  it('recurses into nested objects and arrays (dropping null array entries)', () => {
    const out = sanitizeMetadata({
      nested: { html: '<b>x</b>', n: 5 },
      arr: ['=bad', 'ok', null],
    });
    expect(out?.nested).toEqual({ html: 'x', n: 5 });
    expect(out?.arr).toEqual(['bad', 'ok']);
  });

  it('reduces untrusted keys to plain [A-Za-z0-9_] identifiers', () => {
    const out = sanitizeMetadata({
      valid_key: 'a',
      'ev<!-- -->il': 'b',
      'has space': 'c',
    } as Record<string, unknown>);
    expect(Object.keys(out ?? {})).toEqual(['valid_key', 'evil', 'hasspace']);
  });

  it('returns null for null/undefined/non-object input', () => {
    expect(sanitizeMetadata(null)).toBeNull();
    expect(sanitizeMetadata(undefined)).toBeNull();
  });

  it('preserves explicit null scalar values (a "not found" survives a reprocess)', () => {
    expect(sanitizeMetadata({ subject: null })?.subject).toBeNull();
  });

  it('is idempotent on already-clean data', () => {
    const clean = { subject: 'Wartung', contract_value: 24000, effective_date: '2026-01-01' };
    expect(sanitizeMetadata(clean)).toEqual(clean);
    expect(sanitizeMetadata(sanitizeMetadata(clean) ?? {})).toEqual(clean);
  });
});
