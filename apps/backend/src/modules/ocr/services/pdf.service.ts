import { Injectable, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';

// Part 3: AI Pipeline - PDF text extraction
// Handles extracting text from PDFs (both text and scanned)

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

  /**
   * Extract text from a PDF buffer
   * @param buffer - PDF file buffer
   * @returns Extracted text and metadata
   */
  async extractText(buffer: Buffer): Promise<{
    text: string;
    pageTexts: string[];
    pageCount: number;
    hasEmbeddedText: boolean;
  }> {
    try {
      this.logger.log('Extracting text from PDF');

      const data = await pdfParse(buffer);

      // Check if PDF has actual text content
      const hasText = Boolean(data.text && data.text.trim().length > 50);

      this.logger.log(`PDF extraction complete - Pages: ${data.numpages}, Has text: ${hasText}`);

      return {
        text: data.text || '',
        pageTexts: [], // pdf-parse doesn't provide per-page text easily
        pageCount: data.numpages,
        hasEmbeddedText: hasText,
      };
    } catch (error) {
      this.logger.error(`Failed to extract PDF text: ${error instanceof Error ? error.message : String(error)}`);
      // Return empty result on error - will fall back to OCR
      return {
        text: '',
        pageTexts: [],
        pageCount: 1,
        hasEmbeddedText: false,
      };
    }
  }

  /**
   * Convert PDF pages to PNG images for OCR (scanned / image-only PDFs).
   * Uses pdf-to-img (already a dependency). It is ESM-only while this project is
   * CommonJS, so it is imported dynamically to avoid ERR_REQUIRE_ESM.
   * @param buffer - PDF file buffer
   * @returns Array of PNG image buffers (one per page)
   */
  async pdfToImages(buffer: Buffer): Promise<Buffer[]> {
    // scale ≈ DPI/72: 3 ≈ 216 DPI (good OCR/speed balance), 4 ≈ 288 DPI.
    const scale = Number(process.env.PDF_RENDER_SCALE) || 3;
    this.logger.log(`Converting PDF to images at scale ${scale}`);

    try {
      const { pdf } = await import('pdf-to-img');
      const doc = await pdf(buffer, { scale });
      const images: Buffer[] = [];
      for await (const page of doc) {
        images.push(page);
      }
      this.logger.log(`Rendered ${images.length} PDF page(s) to images`);
      return images;
    } catch (error) {
      this.logger.error(`Failed to convert PDF to images: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get PDF metadata
   * @param buffer - PDF file buffer
   * @returns PDF metadata
   */
  async getMetadata(buffer: Buffer): Promise<{
    pageCount: number;
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
  }> {
    try {
      const data = await pdfParse(buffer);

      return {
        pageCount: data.numpages,
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject,
        keywords: data.info?.Keywords,
        creator: data.info?.Creator,
        producer: data.info?.Producer,
        creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : undefined,
        modificationDate: data.info?.ModDate ? new Date(data.info.ModDate) : undefined,
      };
    } catch (error) {
      this.logger.error(`Failed to get PDF metadata: ${error instanceof Error ? error.message : String(error)}`);
      // Return default metadata on error
      return {
        pageCount: 1,
      };
    }
  }
}
