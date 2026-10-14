import {
  assertImageDimensions,
  maxPdfPages,
  ocrPageTimeoutMs,
  pdfParseTimeoutMs,
  pdfRenderTimeoutMs,
  withTimeout,
} from './processing-limits';

// PD-U1/U2/U4: pipeline stage limits — env parsing, validation, timeouts.
describe('processing-limits', () => {
  describe('env parsing', () => {
    it('defaults MAX_PDF_PAGES to 10 (demo default)', () => {
      expect(maxPdfPages({})).toBe(10);
    });

    it('accepts a valid MAX_PDF_PAGES', () => {
      expect(maxPdfPages({ MAX_PDF_PAGES: '25' })).toBe(25);
    });

    it('rejects invalid MAX_PDF_PAGES loudly', () => {
      expect(() => maxPdfPages({ MAX_PDF_PAGES: '0' })).toThrow(/MAX_PDF_PAGES/);
      expect(() => maxPdfPages({ MAX_PDF_PAGES: '-3' })).toThrow(/MAX_PDF_PAGES/);
      expect(() => maxPdfPages({ MAX_PDF_PAGES: 'many' })).toThrow(/MAX_PDF_PAGES/);
      expect(() => maxPdfPages({ MAX_PDF_PAGES: '10.5' })).toThrow(/MAX_PDF_PAGES/);
    });

    it('defaults and validates the stage timeouts', () => {
      expect(pdfParseTimeoutMs({})).toBe(20_000);
      expect(pdfRenderTimeoutMs({})).toBe(60_000);
      expect(ocrPageTimeoutMs({})).toBe(90_000);
      expect(() => pdfParseTimeoutMs({ PDF_PARSE_TIMEOUT_MS: '0' })).toThrow(/PDF_PARSE_TIMEOUT_MS/);
    });
  });

  describe('withTimeout', () => {
    it('resolves with the inner promise when fast enough', async () => {
      await expect(withTimeout(Promise.resolve('ok'), 1000, 'stage')).resolves.toBe('ok');
    });

    it('rejects with a labeled error when the stage exceeds the budget', async () => {
      jest.useFakeTimers();
      const slow = new Promise<string>(() => undefined);
      const pending = expect(withTimeout(slow, 5, 'PDF rendering')).rejects.toThrow(
        /PDF rendering timed out after 5ms/,
      );
      jest.advanceTimersByTime(10);
      await pending;
      jest.useRealTimers();
    });
  });

  describe('assertImageDimensions', () => {
    it('accepts normal document images', () => {
      expect(() => assertImageDimensions({ width: 2480, height: 3508 })).not.toThrow();
    });

    it('rejects oversized single dimensions', () => {
      expect(() => assertImageDimensions({ width: 20_000, height: 100 })).toThrow(/per side/);
    });

    it('rejects oversized total pixels within the per-side cap', () => {
      expect(() => assertImageDimensions({ width: 12_000, height: 12_000 })).toThrow(
        /exceeds the maximum/,
      );
    });

    it('tolerates missing metadata', () => {
      expect(() => assertImageDimensions({})).not.toThrow();
    });
  });
});
