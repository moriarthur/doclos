// P0-2 / P2-13 (audit): customer find-or-create must be scoped to the
// owning user — the where-clause has to carry user_id, and new customers
// must be created with it.
import { EntityManager } from 'typeorm';
import { DocumentProcessor } from './document.processor';
import { Document } from '../entities/document.entity';

const USER_A = '11111111-1111-1111-1111-111111111111';

const makeProcessor = () => {
  const manager = {
    findOne: jest.fn(),
    create: jest.fn((_entity: unknown, partial: object) => ({
      ...partial,
      id: 'customer-1',
    })),
    save: jest.fn(async (entity: { id?: string }) => entity),
  };
  const dataSource = {
    transaction: jest.fn(async (cb: (m: EntityManager) => Promise<void>) =>
      cb(manager as unknown as EntityManager),
    ),
  };
  const structured = {
    extractInvoiceData: jest.fn(async () => ({
      data: {
        invoice_number: 'R-2026-001',
        invoice_date: '03.04.2026',
        due_date: null,
        amount_total: '1.200,50',
        vat_amount: null,
        currency: 'EUR',
        supplier_name: 'Müller GmbH',
        supplier_address: 'Bahnhofstr. 1',
        items: [],
      },
      confidence: { overall: 0.95, fields: {} },
      cost: 0,
    })),
    // identity passthrough — the real one is exercised by its own spec
    normalizeExtraction: (e: object) => e,
  };

  const processor = new DocumentProcessor(
    {} as any, // documentsRepository
    {} as any, // invoicesRepository
    {} as any, // invoiceItemsRepository
    {} as any, // fieldExtractionsRepository
    {} as any, // jobsRepository
    {} as any, // s3Service
    dataSource as any,
    {} as any, // ocrService
    {} as any, // documentClassifierService
    structured as any,
  );

  return { processor, manager, dataSource };
};

describe('DocumentProcessor customer scoping (P0-2)', () => {
  it('looks up customers scoped by user_id and creates them with it', async () => {
    const { processor, manager } = makeProcessor();
    manager.findOne.mockResolvedValue(null); // no customer for this user yet

    const document = {
      id: 'doc-1',
      user_id: USER_A,
      customer_id: null,
      invoiceId: null,
      status: 'processing',
    } as unknown as Document;

    await (processor as unknown as { extractInvoiceData: (d: Document, t: string) => Promise<void> }).extractInvoiceData(
      document,
      'Rechnung Müller GmbH',
    );

    expect(manager.findOne).toHaveBeenCalledWith(
      expect.anything(), // Customer entity
      expect.objectContaining({
        where: expect.objectContaining({
          user_id: USER_A,
          name: 'Müller GmbH',
        }),
      }),
    );
    expect(manager.create).toHaveBeenCalledWith(
      expect.anything(), // Customer entity
      expect.objectContaining({ user_id: USER_A, name: 'Müller GmbH' }),
    );
    expect(document.customer_id).toBe('customer-1');
  });

  it('reuses an existing same-tenant customer without creating a duplicate', async () => {
    const { processor, manager } = makeProcessor();
    manager.findOne.mockResolvedValue({ id: 'existing-customer', user_id: USER_A });

    const document = {
      id: 'doc-1',
      user_id: USER_A,
      customer_id: null,
      invoiceId: null,
      status: 'processing',
    } as unknown as Document;

    await (processor as unknown as { extractInvoiceData: (d: Document, t: string) => Promise<void> }).extractInvoiceData(
      document,
      'Rechnung Müller GmbH',
    );

    expect(document.customer_id).toBe('existing-customer');
    expect(manager.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Müller GmbH' }),
    );
  });
});
