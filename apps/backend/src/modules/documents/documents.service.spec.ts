import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import { DocumentsService } from './documents.service';
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
