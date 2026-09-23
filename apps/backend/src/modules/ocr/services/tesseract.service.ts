import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createWorker, type Worker } from 'tesseract.js';

// Part 3: AI Pipeline - Tesseract OCR service
// Performs OCR on preprocessed images

@Injectable()
export class TesseractService implements OnModuleDestroy {
  private readonly logger = new Logger(TesseractService.name);
  private readonly languages: string;

  // H-6 (audit wave 3): one long-lived worker reused across pages/calls instead
  // of create+terminate per recognize — worker boot (wasm + traineddata) used to
  // dominate scanned-PDF OCR time. Tesseract workers are not concurrency-safe,
  // so recognize calls are serialized through a promise-chain mutex.
  private worker: Worker | null = null;
  private workerInit: Promise<Worker> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private configService: ConfigService) {
    // Default: German + English for German market
    this.languages = this.configService.get('TESSERACT_LANGUAGES') || 'deu+eng';
  }

  /** Lazily boot the shared worker; a failed boot clears itself for retry. */
  private getWorker(): Promise<Worker> {
    if (this.worker) return Promise.resolve(this.worker);
    this.workerInit ??= createWorker(this.languages)
      .then(async (worker) => {
        await worker.setParameters({
          // @ts-expect-error - Tesseract.js types may not match actual API
          tessedit_pageseg_mode: '3', // Automatic page segmentation
          preserve_interword_spaces: '1',
        });
        this.worker = worker;
        this.logger.log(
          `Tesseract worker initialized (languages: ${this.languages}) — reused across calls`,
        );
        return worker;
      })
      .catch((error) => {
        // Allow the next call to retry initialization from scratch.
        this.workerInit = null;
        throw error;
      });
    return this.workerInit;
  }

  /** Serialize worker access — a Tesseract worker serves one recognize at a time. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined); // don't poison the chain with a failed run
    return run;
  }

  /** Discard a worker after an unexpected error — the next call boots a fresh one. */
  private async recycleWorker(worker: Worker): Promise<void> {
    this.worker = null;
    this.workerInit = null;
    try {
      await worker.terminate();
    } catch {
      // already dead — nothing to do
    }
  }

  async onModuleDestroy(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.workerInit = null;
    if (worker) {
      try {
        await worker.terminate();
      } catch (error) {
        this.logger.warn(
          `Tesseract worker terminate failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  /**
   * Perform OCR on an image buffer
   * @param imageBuffer - Preprocessed image buffer
   * @returns OCR result with text and confidence
   */
  async performOcr(imageBuffer: Buffer): Promise<{
    text: string;
    confidence: number;
    words: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }> {
    return this.runExclusive(async () => {
      this.logger.log(`Starting OCR with languages: ${this.languages}`);
      const worker = await this.getWorker();

      let result;
      try {
        // Perform OCR
        result = await worker.recognize(imageBuffer);
      } catch (error) {
        await this.recycleWorker(worker);
        this.logger.error(`OCR failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }

      // Calculate average confidence
      const confidence = result.data.confidence;

      // Extract words with bounding boxes
      const words = result.data.words.map((word) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: {
          x0: word.bbox.x0,
          y0: word.bbox.y0,
          x1: word.bbox.x1,
          y1: word.bbox.y1,
        },
      }));

      this.logger.log(`OCR complete with confidence: ${confidence}%`);

      // Check if confidence is below threshold
      const fallbackThreshold = parseFloat(
        this.configService.get('OCR_FALLBACK_THRESHOLD') || '0.70',
      );
      if (confidence / 100 < fallbackThreshold) {
        this.logger.warn(
          `OCR confidence (${confidence}%) below threshold (${fallbackThreshold * 100}%)`,
        );
      }

      return {
        text: result.data.text,
        confidence: confidence / 100, // Convert to 0-1 range
        words,
      };
    });
  }

  /**
   * Perform OCR with detailed line and paragraph information
   * @param imageBuffer - Preprocessed image buffer
   * @returns Detailed OCR result
   */
  async performDetailedOcr(imageBuffer: Buffer): Promise<{
    text: string;
    confidence: number;
    lines: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
    paragraphs: Array<{
      text: string;
      confidence: number;
      bbox: { x0: number; y0: number; x1: number; y1: number };
    }>;
  }> {
    return this.runExclusive(async () => {
      this.logger.log('Starting detailed OCR');
      const worker = await this.getWorker();

      let result;
      try {
        result = await worker.recognize(imageBuffer);
      } catch (error) {
        await this.recycleWorker(worker);
        this.logger.error(
          `Detailed OCR failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }

      // Extract lines
      const lines =
        result.data.lines?.map((line) => ({
          text: line.text,
          confidence: line.confidence,
          bbox: line.bbox,
        })) || [];

      // Extract paragraphs
      const paragraphs =
        result.data.paragraphs?.map((para) => ({
          text: para.text,
          confidence: para.confidence,
          bbox: para.bbox,
        })) || [];

      this.logger.log('Detailed OCR complete');

      return {
        text: result.data.text,
        confidence: result.data.confidence / 100,
        lines,
        paragraphs,
      };
    });
  }

  /**
   * Check if OCR result quality is acceptable
   * @param confidence - OCR confidence score (0-1)
   * @returns True if quality is acceptable
   */
  isQualityAcceptable(confidence: number): boolean {
    const threshold = parseFloat(
      this.configService.get('OCR_FALLBACK_THRESHOLD') || '0.70',
    );
    return confidence >= threshold;
  }
}
