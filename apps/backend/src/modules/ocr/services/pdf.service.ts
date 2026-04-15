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
   * Convert PDF pages to images
   * @param _buffer - PDF file buffer (not used yet)
   * @returns Array of image buffers (one per page)
   */
  async pdfToImages(_buffer: Buffer): Promise<Buffer[]> {
    try {
      this.logger.log('Converting PDF to images');

      // For now, use a simpler approach - use pdfjs-dist directly
      // This will be implemented separately
      // For now, throw an error to force OCR fallback
      throw new Error('PDF to image conversion not yet implemented - using OCR fallback');

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
