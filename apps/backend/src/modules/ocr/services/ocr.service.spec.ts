import { OcrService } from './ocr.service';

// PD-U1: the page cap must trip BEFORE rendering/OCR/LLM — a 500-page PDF
// must cost one metadata read, not a render storm.
describe('OcrService PDF page limit', () => {
  const makeService = (metadata: { pageCount: number }) => {
    const calls = { extractText: 0, pdfToImages: 0 };
    const pdfService = {
      getMetadata: async () => metadata,
      extractText: async () => {
        calls.extractText++;
        return { text: '', pageTexts: [], hasEmbeddedText: false, confidence: 0 };
      },
      pdfToImages: async () => {
        calls.pdfToImages++;
        return [];
      },
    };
    const service = Object.create(OcrService.prototype) as OcrService;
    Object.defineProperty(service, 'pdfService', { value: pdfService });
    Object.defineProperty(service, 'imagePreprocessingService', {
      value: { preprocessImage: async (b: Buffer) => b },
    });
    Object.defineProperty(service, 'tesseractService', {
      value: { performOcr: async () => ({ text: '', confidence: 1 }) },
    });
    Object.defineProperty(service, 'jobsRepository', { value: {} });
    Object.defineProperty(service, 'logger', {
      value: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    });
    return { service, calls };
  };

  it('rejects a PDF beyond MAX_PDF_PAGES before any extraction work', async () => {
    const { service, calls } = makeService({ pageCount: 50 });
    await expect(
      service.processDocument(Buffer.from('%PDF-1.4'), 'application/pdf'),
    ).rejects.toThrow(/maximum supported is 10/);
    expect(calls.extractText).toBe(0);
    expect(calls.pdfToImages).toBe(0);
  });

  it('admits a PDF within the limit', async () => {
    const { service, calls } = makeService({ pageCount: 2 });
    await expect(
      service.processDocument(Buffer.from('%PDF-1.4'), 'application/pdf'),
    ).resolves.toBeDefined();
    // Extract path ran (embedded text empty → falls through to render+OCR on
    // the empty image list, ending with an empty-text result).
    expect(calls.extractText).toBe(1);
  });
});
