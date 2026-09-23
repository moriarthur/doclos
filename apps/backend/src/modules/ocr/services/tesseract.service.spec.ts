import { TesseractService } from './tesseract.service';

// H-6 (audit wave 3): the Tesseract worker is long-lived — booted once, reused
// across recognize calls, terminated on module destroy, recycled after errors.

const makeMockWorker = () => ({
  setParameters: jest.fn().mockResolvedValue(undefined),
  recognize: jest.fn().mockResolvedValue({
    data: { text: 'page text', confidence: 92, words: [] },
  }),
  terminate: jest.fn().mockResolvedValue(undefined),
});

const mockWorkers: ReturnType<typeof makeMockWorker>[] = [];

jest.mock('tesseract.js', () => ({
  createWorker: jest.fn(() => {
    const worker = makeMockWorker();
    mockWorkers.push(worker);
    return Promise.resolve(worker);
  }),
}));

const makeService = () =>
  new TesseractService({ get: () => undefined } as never);

describe('TesseractService — worker reuse (H-6)', () => {
  beforeEach(() => {
    mockWorkers.length = 0;
  });

  it('boots one worker and reuses it across sequential calls', async () => {
    const service = makeService();

    await service.performOcr(Buffer.from('a'));
    await service.performOcr(Buffer.from('b'));
    await service.performOcr(Buffer.from('c'));

    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0].recognize).toHaveBeenCalledTimes(3);
    expect(mockWorkers[0].terminate).not.toHaveBeenCalled();
  });

  it('applies OCR parameters once at worker boot', async () => {
    const service = makeService();

    await service.performOcr(Buffer.from('a'));
    await service.performOcr(Buffer.from('b'));

    expect(mockWorkers[0].setParameters).toHaveBeenCalledTimes(1);
  });

  it('shares the same worker between performOcr and performDetailedOcr', async () => {
    const service = makeService();

    await service.performOcr(Buffer.from('a'));
    await service.performDetailedOcr(Buffer.from('b'));

    expect(mockWorkers).toHaveLength(1);
    expect(mockWorkers[0].recognize).toHaveBeenCalledTimes(2);
  });

  it('recycles the worker after a recognize failure and boots a fresh one next call', async () => {
    const service = makeService();

    await service.performOcr(Buffer.from('a')); // boot worker #1
    mockWorkers[0].recognize.mockRejectedValueOnce(new Error('worker wedged'));
    await expect(service.performOcr(Buffer.from('b'))).rejects.toThrow('worker wedged');

    expect(mockWorkers[0].terminate).toHaveBeenCalled();

    await service.performOcr(Buffer.from('c')); // boots worker #2
    expect(mockWorkers).toHaveLength(2);
    expect(mockWorkers[1].recognize).toHaveBeenCalledTimes(1);
  });

  it('terminates the worker on module destroy', async () => {
    const service = makeService();

    await service.performOcr(Buffer.from('a'));
    await service.onModuleDestroy();

    expect(mockWorkers[0].terminate).toHaveBeenCalledTimes(1);

    // a call after destroy boots a fresh worker
    await service.performOcr(Buffer.from('b'));
    expect(mockWorkers).toHaveLength(2);
  });
});
