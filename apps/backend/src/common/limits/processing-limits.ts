// PD-U1/PD-U2 (public-demo audit): pipeline stage limits. Every value is
// env-configurable and validated at read time — an invalid value aborts the
// pipeline stage loudly instead of silently falling back to "unlimited".
//
// Defaults are tuned for the public demo (10-page synthetic/administrative
// documents), not for bulk backlogs.

/** Hard page cap for PDFs — pages beyond this never reach OCR or the LLM. */
export function maxPdfPages(env: NodeJS.ProcessEnv = process.env): number {
  return intInRange(env.MAX_PDF_PAGES, 10, 1, 500, 'MAX_PDF_PAGES');
}

/** pdf-parse (embedded text) budget per document. */
export function pdfParseTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return intInRange(env.PDF_PARSE_TIMEOUT_MS, 20_000, 1_000, 300_000, 'PDF_PARSE_TIMEOUT_MS');
}

/** pdf-to-img render budget per document (all pages). */
export function pdfRenderTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return intInRange(env.PDF_RENDER_TIMEOUT_MS, 60_000, 1_000, 600_000, 'PDF_RENDER_TIMEOUT_MS');
}

/** Tesseract budget per page (or per image document). */
export function ocrPageTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return intInRange(env.OCR_PAGE_TIMEOUT_MS, 90_000, 1_000, 600_000, 'OCR_PAGE_TIMEOUT_MS');
}

/** A single image dimension/pixel budget — huge images blow up sharp+OCR. */
export const MAX_IMAGE_DIMENSION_PX = 15_000;
export const MAX_IMAGE_TOTAL_PIXELS = 60_000_000; // ~60 MP

/**
 * Reject images whose dimensions exceed the pixel budget before sharp/OCR
 * allocate memory for them.
 */
export function assertImageDimensions(meta: { width?: number; height?: number }): void {
  const { width = 0, height = 0 } = meta;
  if (width > MAX_IMAGE_DIMENSION_PX || height > MAX_IMAGE_DIMENSION_PX) {
    throw new Error(
      `Image dimensions ${width}x${height} exceed the maximum of ${MAX_IMAGE_DIMENSION_PX}px per side`,
    );
  }
  if (width * height > MAX_IMAGE_TOTAL_PIXELS) {
    throw new Error(
      `Image resolution (${width}x${height}) exceeds the maximum of ${MAX_IMAGE_TOTAL_PIXELS} pixels`,
    );
  }
}

/** Race a promise against a timeout; the loser produces a labeled error. */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function intInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Invalid ${name}: "${raw}" (expected integer ${min}-${max})`);
  }
  return value;
}
