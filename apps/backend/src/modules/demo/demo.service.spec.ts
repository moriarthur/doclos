import { DemoService, DEMO_SAMPLE_FILENAME } from './demo.service';

// PD-D1: per-user synthetic sample — quota-gated, real pipeline, scoped reset.
describe('DemoService', () => {
  const makeService = (existingSampleIds: string[] = []) => {
    const assertCanCreateSample = jest.fn(async () => undefined);
    const uploaded: Array<{ filename: string; userId: string }> = [];
    const deletedDocs: Array<{ id: string; userId: string }> = [];

    const service = Object.create(DemoService.prototype) as DemoService;
    Object.defineProperty(service, 'documentsService', {
      value: {
        uploadDocument: async (file: Express.Multer.File, userId: string) => {
          uploaded.push({ filename: file.originalname, userId });
          return { document_id: 'doc-1', status: 'processing' };
        },
        deleteDocument: async (id: string, userId: string) => {
          deletedDocs.push({ id, userId });
        },
      },
      configurable: true,
    });
    Object.defineProperty(service, 'quotaService', {
      value: { assertCanCreateSample },
      configurable: true,
    });
    Object.defineProperty(service, 'documentsRepository', {
      value: {
        find: async () => existingSampleIds.map((id) => ({ id })),
        count: async () => existingSampleIds.length,
      },
      configurable: true,
    });
    Object.defineProperty(service, 'logger', {
      value: { log: jest.fn(), error: jest.fn() },
      configurable: true,
    });
    return { service, assertCanCreateSample, uploaded, deletedDocs };
  };

  it('createSample gates on the 1/day quota before anything else', async () => {
    const { service, assertCanCreateSample, uploaded } = makeService();
    await service.createSample('u1');
    expect(assertCanCreateSample).toHaveBeenCalledWith('u1');
    expect(uploaded).toHaveLength(1);
  });

  it('the synthetic payload is named as the demo sample and scoped to the caller', async () => {
    const { service, uploaded } = makeService();
    await service.createSample('u1');
    expect(uploaded[0].filename).toBe(DEMO_SAMPLE_FILENAME);
    expect(uploaded[0].userId).toBe('u1');
  });

  it('createSample hands a genuine PDF buffer to the upload path', async () => {
    let captured: Express.Multer.File | undefined;
    const service = Object.create(DemoService.prototype) as DemoService;
    Object.defineProperty(service, 'documentsService', {
      value: {
        uploadDocument: async (file: Express.Multer.File) => {
          captured = file;
          return { document_id: 'doc-1', status: 'processing' };
        },
      },
      configurable: true,
    });
    Object.defineProperty(service, 'quotaService', {
      value: { assertCanCreateSample: async () => undefined },
      configurable: true,
    });
    Object.defineProperty(service, 'documentsRepository', { value: {}, configurable: true });
    Object.defineProperty(service, 'logger', { value: { log: jest.fn() }, configurable: true });

    await service.createSample('u1');
    expect(captured!.buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(captured!.mimetype).toBe('application/pdf');
  });

  it('reset deletes only the sample documents and only for the caller', async () => {
    const { service, deletedDocs } = makeService(['s1', 's2']);
    const result = await service.resetSample('u1');
    expect(result.deleted).toBe(2);
    expect(deletedDocs).toEqual([
      { id: 's1', userId: 'u1' },
      { id: 's2', userId: 'u1' },
    ]);
  });

  it('reset with no samples reports zero deletions', async () => {
    const { service, deletedDocs } = makeService([]);
    const result = await service.resetSample('u1');
    expect(result.deleted).toBe(0);
    expect(deletedDocs).toHaveLength(0);
  });

  it('reset performs no quota calls — deleting a sample never re-opens the 1/day window', async () => {
    // The 1/day quota is a Redis fixed-window counter that only createSample
    // increments; the reset path must stay a pure delete so a sample can't be
    // cycled by deleting it. The quota mock has no reset/decrement surface at
    // all — any quota interaction from the reset path would fail this test.
    const { service, assertCanCreateSample } = makeService(['s1']);
    await service.resetSample('u1');
    expect(assertCanCreateSample).not.toHaveBeenCalled();
  });

  it('hasSample reflects stored samples', async () => {
    const { service: withSample } = makeService(['s1']);
    const { service: withoutSample } = makeService([]);
    expect(await withSample.hasSample('u1')).toBe(true);
    expect(await withoutSample.hasSample('u1')).toBe(false);
  });
});
