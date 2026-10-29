// P0-2 / P2-13 (audit): customer find-or-create must be scoped to the
// owning user — the where-clause has to carry user_id, and new customers
// must be created with it.
import { DataSource, EntityManager, Repository } from 'typeorm';
import { DocumentProcessor } from './document.processor';
import { Document } from '../entities/document.entity';
import { Customer } from '../entities/customer.entity';
import { Invoice } from '../entities/invoice.entity';
import { InvoiceItem } from '../entities/invoice-item.entity';
import { FieldExtraction } from '../entities/field-extraction.entity';
import { Job as JobEntity } from '../../jobs/entities/job.entity';
import { S3Service } from '../../storage/services/s3.service';
import { OcrService } from '../../ocr/services/ocr.service';
import { DocumentClassifierService } from '../../ai/services/document-classifier.service';
import { StructuredExtractionService } from '../../ai/services/structured-extraction.service';

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
      confidence: { overall: 0.95, fields: {}, issues: [] },
      cost: 0,
    })),
    // identity passthrough — the real one is exercised by its own spec
    normalizeExtraction: (e: object) => e,
    // S5.1 correctness guard: no issues from the stubbed service
    validateByType: jest.fn(() => [] as Array<unknown>),
  };

  const processor = new DocumentProcessor(
    {} as Repository<Document>, // documentsRepository
    // customersRepository (per-type paths; this spec exercises the manager path)
    {} as Repository<Customer>,
    // fieldExtractionsRepository (pre-extraction cleanup now goes through the
    // transaction manager — DD-2)
    {} as Repository<FieldExtraction>,
    {} as Repository<JobEntity>, // jobsRepository
    {} as S3Service, // s3Service
    dataSource as unknown as DataSource,
    {} as OcrService, // ocrService
    {} as DocumentClassifierService, // documentClassifierService
    structured as unknown as StructuredExtractionService,
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

    await (
      processor as unknown as {
        extractCommercialDocument: (d: Document, t: string, type: string) => Promise<void>;
      }
    ).extractCommercialDocument(document, 'Rechnung Müller GmbH', 'invoice');

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

    await (
      processor as unknown as {
        extractCommercialDocument: (d: Document, t: string, type: string) => Promise<void>;
      }
    ).extractCommercialDocument(document, 'Rechnung Müller GmbH', 'invoice');

    expect(document.customer_id).toBe('existing-customer');
    expect(manager.create).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Müller GmbH' }),
    );
  });
});

// DD-2 (deployed-demo 500 root producer): the previous-run cleanup must be ONE
// transaction. The old non-transactional sequence (save document with
// invoiceId=NULL → delete items → delete invoice) left an orphan invoice row
// behind whenever the process died in between, which then FK-blocked every
// delete of that document (see DD-1 in documents.service).
describe('DocumentProcessor previous-run cleanup (DD-2)', () => {
  it('runs the invoice teardown inside one transaction, in FK-safe order', async () => {
    const manager = {
      delete: jest.fn(async () => undefined),
      save: jest.fn(async (e: object) => e),
    };
    const dataSource = {
      transaction: jest.fn(
        async (cb: (m: unknown) => Promise<unknown>) => cb(manager),
      ),
    };
    const documentsRepository = {
      findOne: jest.fn(async () => ({
        id: 'doc-1',
        user_id: 'u1',
        invoiceId: 'old-inv',
        status: 'processing',
        s3_key: 'k',
        mime_type: 'application/pdf',
      })),
      save: jest.fn(async (e: object) => e),
    };
    const jobsRepository = {
      findOne: jest.fn(async () => null),
      create: jest.fn((x: object) => ({ id: 'job-1', ...x })),
      save: jest.fn(async (e: object) => e),
    };
    // The cleanup runs before the S3 download — fail there to end the run.
    const s3Service = {
      downloadFile: jest.fn(async () => {
        throw new Error('storage unavailable');
      }),
    };
    const processor = new DocumentProcessor(
      documentsRepository as never, // documentsRepository
      {} as never, // customersRepository
      {} as never, // fieldExtractionsRepository
      jobsRepository as never, // jobsRepository
      s3Service as never, // s3Service
      dataSource as never, // dataSource
      {} as never, // ocrService
      {} as never, // documentClassifierService
      {} as never, // structuredExtractionService
    );

    await expect(
      processor.handleProcessDocument({
        data: { documentId: 'doc-1', userId: 'u1' },
        progress: jest.fn(),
      } as never),
    ).rejects.toThrow('storage unavailable');

    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    expect(manager.delete).toHaveBeenCalledWith(FieldExtraction, { document_id: 'doc-1' });
    expect(manager.save).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: null }),
    );
    expect(manager.delete).toHaveBeenCalledWith(InvoiceItem, { invoice_id: 'old-inv' });
    expect(manager.delete).toHaveBeenCalledWith(Invoice, { id: 'old-inv' });
  });
});
