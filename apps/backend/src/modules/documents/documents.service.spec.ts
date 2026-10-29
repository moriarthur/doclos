import { BadRequestException, NotFoundException, UnsupportedMediaTypeException } from '@nestjs/common';
import { FindOperator } from 'typeorm';
import { DocumentsService } from './documents.service';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { MAX_UPLOAD_BYTES } from './upload-constraints';

// PD-U5 / Phase 3.11: upload admission — magic bytes, size cap, MIME
// allowlist. All collaborators mocked; no storage/queue/DB touched.
describe('DocumentsService.uploadDocument validation', () => {
  const makeService = (
    over: {
      repository?: { create: (x: object) => object; save: (x: object) => Promise<object> };
      queue?: { add: (...args: unknown[]) => Promise<unknown> };
    } = {},
  ) => {
    // Typed without naming the (unused) params — keeps eslint quiet and gives
    // the assertions a real tuple type. Sync impl: the service awaits it.
    const s3Upload = jest.fn<string, [string, Buffer, string]>(() => 'key');
    const queueAdd = jest.fn(
      over.queue?.add ?? (async () => undefined),
    );
    const service = Object.create(DocumentsService.prototype) as DocumentsService;
    Object.defineProperty(service, 'documentsRepository', {
      value:
        over.repository ?? {
          create: (x: object) => ({ id: '11111111-1111-4111-8111-111111111111', ...x }),
          save: async (x: object) => x,
        },
    });
    Object.defineProperty(service, 'quotaService', {
      value: { assertUploadQuota: async () => undefined },
    });
    Object.defineProperty(service, 's3Service', { value: { uploadFile: s3Upload } });
    Object.defineProperty(service, 'documentsQueue', { value: { add: queueAdd } });
    Object.defineProperty(service, 'logger', { value: { error: jest.fn(), log: jest.fn() } });
    return { service, s3Upload, queueAdd };
  };

  const makeFile = (over: Partial<Express.Multer.File> = {}): Express.Multer.File =>
    ({
      fieldname: 'file',
      originalname: 'invoice.pdf',
      encoding: '7bit',
      mimetype: 'application/pdf',
      size: 1024,
      buffer: Buffer.from('%PDF-1.4 synthetic test document'),
      ...over,
    }) as Express.Multer.File;

  it('rejects an oversized file before any storage write', async () => {
    const { service, s3Upload } = makeService();
    const file = makeFile({ size: MAX_UPLOAD_BYTES + 1 });
    await expect(service.uploadDocument(file, 'u1')).rejects.toMatchObject({
      message: 'File too large',
    });
    expect(s3Upload).not.toHaveBeenCalled();
  });

  it('rejects an unsupported declared MIME type', async () => {
    const { service, s3Upload } = makeService();
    const file = makeFile({ mimetype: 'application/zip' });
    await expect(service.uploadDocument(file, 'u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(s3Upload).not.toHaveBeenCalled();
  });

  it('rejects a fake PDF whose bytes are not PDF magic (PD-U5)', async () => {
    const { service, s3Upload } = makeService();
    const file = makeFile({ buffer: Buffer.from('definitely not a portable document format') });
    await expect(service.uploadDocument(file, 'u1')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(s3Upload).not.toHaveBeenCalled();
  });

  it('rejects a fake PNG (PDF bytes wearing a PNG content type)', async () => {
    const { service } = makeService();
    const file = makeFile({ mimetype: 'image/png', buffer: Buffer.from('%PDF-1.4 trickery') });
    await expect(service.uploadDocument(file, 'u1')).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
  });

  it('admits a real PDF-shaped upload and queues exactly one job', async () => {
    const { service, s3Upload, queueAdd } = makeService();
    const result = await service.uploadDocument(makeFile(), 'u1');
    expect(result.status).toBeDefined();
    expect(result.document_id).toBeDefined();
    expect(s3Upload).toHaveBeenCalledTimes(1);
    expect(queueAdd).toHaveBeenCalledTimes(1);
    // PD-U5: storage keys never carry the raw filename — UUID-based.
    const key = s3Upload.mock.calls[0][0] as string;
    expect(key).toMatch(/^uploads\/\d{4}\/\d{2}\/\d{2}\/[0-9a-f-]{36}\.pdf$/);
    expect(key).not.toContain('invoice.pdf');
  });

  it('marks the document errored and surfaces a clear failure when the queue is down', async () => {
    const saved: Array<Record<string, unknown>> = [];
    const { service, s3Upload } = makeService({
      repository: {
        create: (x: object) => ({ id: 'd2', ...x }),
        save: async (x: object) => {
          saved.push(x as Record<string, unknown>);
          return x;
        },
      },
      queue: { add: async () => { throw new Error('redis down'); } },
    });

    await expect(service.uploadDocument(makeFile(), 'u1')).rejects.toMatchObject({
      message: expect.stringContaining('queue unavailable'),
    });
    // The document row must not advertise a live job.
    expect(saved[0].status).toBe('error');
    expect(s3Upload).toHaveBeenCalledTimes(1);
  });
});

// DD-1 (deployed-demo 500): the delete order contract. Invoices must be
// collected by document_id — not via the documents.invoiceId pointer alone —
// so an orphaned invoice (pointer already NULL, row alive after a crashed
// reprocess) can never FK-block the document delete again. Repository-mocked:
// the real-FK proof lives in documents.service.integration.spec.ts.
describe('DocumentsService.deleteDocument (DD-1)', () => {
  const makeDeleteService = (
    over: {
      document?: Record<string, unknown> | null;
      invoices?: Array<{ id: string }>;
      deleteFile?: () => Promise<void>;
    } = {},
  ) => {
    // `in` check, not ?? — an explicit null document (the 404 case) must win.
    const document =
      'document' in over && over.document !== undefined
        ? over.document
        : {
            id: 'doc-1',
            user_id: 'u1',
            invoiceId: 'inv-1',
            s3_key: 'k',
            original_filename: 'f.pdf',
            status: 'parsed',
          };
    const manager = {
      find: jest.fn(async () => over.invoices ?? [{ id: 'inv-1' }]),
      save: jest.fn(async (e: object) => e),
      delete: jest.fn(async () => undefined),
    };
    // Typed view of the calls — jest infers a zero-arg tuple from the impl.
    const deleteCalls = manager.delete.mock.calls as unknown as Array<[unknown, unknown]>;
    const deleteFile = over.deleteFile ?? jest.fn(async () => undefined);
    const enqueue = jest.fn(async () => undefined);
    const purgeQueued = jest.fn(async () => 0);
    const service = Object.create(DocumentsService.prototype) as DocumentsService;
    Object.defineProperty(service, 'documentsRepository', {
      value: { findOne: jest.fn(async () => document) },
    });
    Object.defineProperty(service, 'dataSource', {
      value: {
        transaction: async (cb: (m: unknown) => Promise<void>) => cb(manager),
      },
    });
    Object.defineProperty(service, 's3Service', { value: { deleteFile } });
    Object.defineProperty(service, 'storageCleanupService', { value: { enqueue, purgeQueued } });
    Object.defineProperty(service, 'logger', { value: { log: jest.fn(), error: jest.fn() } });
    return { service, manager, deleteCalls, deleteFile, enqueue, purgeQueued, document };
  };

  it('deletes invoices by document_id even when the invoiceId pointer is NULL (orphan safety)', async () => {
    const { service, manager, deleteCalls } = makeDeleteService({
      document: {
        id: 'doc-1',
        user_id: 'u1',
        invoiceId: null,
        s3_key: 'k',
        original_filename: 'f.pdf',
        status: 'error',
      },
      invoices: [{ id: 'inv-orphan' }],
    });

    await expect(service.deleteDocument('doc-1', 'u1')).resolves.toBeUndefined();

    expect(manager.find).toHaveBeenCalledWith(Invoice, {
      where: { document_id: 'doc-1' },
      select: ['id'],
    });
    expect(manager.delete).toHaveBeenCalledWith(Invoice, { document_id: 'doc-1' });
    // In() surfaces as a FindOperator — assert on its payload.
    const itemDelete = deleteCalls.find(([entity]) => entity === InvoiceItem)?.[1] as
      | { invoice_id: FindOperator<string> }
      | undefined;
    expect(itemDelete?.invoice_id).toBeInstanceOf(FindOperator);
    expect(itemDelete?.invoice_id.value).toEqual(['inv-orphan']);
    // Pointer already NULL → no pointless document UPDATE inside the transaction
    // (the only other save is the audit log insert).
    expect(manager.save).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'doc-1' }));
  });

  it('clears the invoiceId pointer before deleting invoices when it is set', async () => {
    const { service, manager, deleteCalls, document } = makeDeleteService();

    await service.deleteDocument('doc-1', 'u1');

    expect((document as { invoiceId?: string | null }).invoiceId).toBeNull();
    expect(manager.save).toHaveBeenCalledWith(document);
    const itemDelete = deleteCalls.find(([entity]) => entity === InvoiceItem)?.[1] as
      | { invoice_id: FindOperator<string> }
      | undefined;
    expect(itemDelete?.invoice_id.value).toEqual(['inv-1']);
    expect(manager.delete).toHaveBeenCalledWith(Invoice, { document_id: 'doc-1' });
  });

  it('returns success and queues retryable cleanup when the storage delete fails', async () => {
    const deleteFile = jest.fn(async () => {
      throw new Error('r2 down');
    });
    const { service, enqueue, purgeQueued } = makeDeleteService({ deleteFile });

    // The DB graph is already committed — a storage outage must not 500 the API.
    await expect(service.deleteDocument('doc-1', 'u1')).resolves.toBeUndefined();
    expect(enqueue).toHaveBeenCalledWith('k');
    expect(purgeQueued).toHaveBeenCalledWith(1);
  });

  it('404s for a document the caller does not own', async () => {
    const { service } = makeDeleteService({ document: null });
    await expect(service.deleteDocument('doc-1', 'u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
