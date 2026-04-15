import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PdfService } from './pdf.service';
import { ImagePreprocessingService } from './image-preprocessing.service';
import { TesseractService } from './tesseract.service';
import { Job } from '../../jobs/entities/job.entity';

// Part 3: AI Pipeline - Complete OCR pipeline
// Orchestrates text extraction from various document types

export enum DocumentCategory {
  TEXT_PDF = 'text_pdf',
  SCANNED_PDF = 'scanned_pdf',
  MIXED_PDF = 'mixed_pdf',
  IMAGE_DOCUMENT = 'image_document',
}

export interface OcrResult {
  text: string;
  confidence: number;
  documentCategory: DocumentCategory;
  pageCount: number;
  pageTexts: Array<{
    pageNumber: number;
    text: string;
    confidence: number;
  }>;
  metadata: {
    hasEmbeddedText: boolean;
    processingMethod: string;
    processingTime: number;
  };
}

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(
    private pdfService: PdfService,
    private imagePreprocessingService: ImagePreprocessingService,
    private tesseractService: TesseractService,
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
  ) {}

  /**
   * Process a document and extract all text
   * @param fileBuffer - Document file buffer (PDF or image)
   * @param mimeType - MIME type of the document
   * @param jobRecord - Optional job record for progress tracking
   * @returns OCR result with text and confidence
   */
  async processDocument(
    fileBuffer: Buffer,
    mimeType: string,
    jobRecord?: any,
  ): Promise<OcrResult> {
    const startTime = Date.now();

    try {
      this.logger.log(`Processing document with MIME type: ${mimeType}`);

      // Determine processing method based on MIME type
      if (mimeType === 'application/pdf') {
        return await this.processPdf(fileBuffer, startTime, jobRecord);
      } else if (mimeType.startsWith('image/')) {
        return await this.processImage(fileBuffer, startTime, jobRecord);
      } else {
        throw new Error(`Unsupported MIME type: ${mimeType}`);
      }
    } catch (error) {
      this.logger.error(`Failed to process document: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Process a PDF document
   * @param buffer - PDF file buffer
   * @param startTime - Processing start time
   * @param jobRecord - Optional job record for progress tracking
   * @returns OCR result
   */
  private async processPdf(buffer: Buffer, startTime: number, jobRecord?: any): Promise<OcrResult> {
    this.logger.log('Processing PDF document');

    // Get PDF metadata
    const metadata = await this.pdfService.getMetadata(buffer);
    
    // Try to extract embedded text first
    const extractedText = await this.pdfService.extractText(buffer);
    
    let documentCategory: DocumentCategory;
    let pageTexts: Array<{ pageNumber: number; text: string; confidence: number }> = [];
    let finalText = '';
    let finalConfidence = 0;

    if (extractedText.hasEmbeddedText && extractedText.text.trim().length > 100) {
      // Text PDF - good quality
      documentCategory = DocumentCategory.TEXT_PDF;
      finalText = extractedText.text;
      finalConfidence = 1.0; // Embedded text is 100% confident
      
      pageTexts = extractedText.pageTexts.map((text, index) => ({
        pageNumber: index + 1,
        text,
        confidence: 1.0,
      }));
      
      this.logger.log('Document identified as text PDF (embedded text found)');
    } else {
      // Scanned or mixed PDF - need OCR
      this.logger.log('Document requires OCR (no embedded text found)');
      
      // Convert PDF to images
      const pageImages = await this.pdfService.pdfToImages(buffer);
      
      // Determine if mixed or fully scanned
      documentCategory = extractedText.hasEmbeddedText
        ? DocumentCategory.MIXED_PDF
        : DocumentCategory.SCANNED_PDF;
      
      // Process each page with OCR
      const results: Array<{ pageNumber: number; text: string; confidence: number }> = [];
      const allTexts: string[] = [];

      // Warn for large PDFs
      if (pageImages.length > 20) {
        this.logger.warn(`Large PDF detected (${pageImages.length} pages). OCR may take 10-30+ seconds per page.`);
      }

      for (let i = 0; i < pageImages.length; i++) {
        const startTime = Date.now();
        this.logger.log(`Processing page ${i + 1}/${pageImages.length}...`);

        // Update job progress
        if (jobRecord) {
          jobRecord.progress = {
            stage: 'ocr',
            message: `Processing page ${i + 1}/${pageImages.length}...`,
            current: i + 1,
            total: pageImages.length,
          };
          await this.jobsRepository.save(jobRecord);
        }

        // Preprocess image
        const preprocessed = await this.imagePreprocessingService.preprocessImage(
          pageImages[i],
        );

        // Perform OCR
        const ocrResult = await this.tesseractService.performOcr(preprocessed);

        const pageTime = Date.now() - startTime;
        this.logger.log(`Page ${i + 1}/${pageImages.length} complete in ${pageTime}ms (confidence: ${(ocrResult.confidence * 100).toFixed(1)}%)`);

        results.push({
          pageNumber: i + 1,
          text: ocrResult.text,
          confidence: ocrResult.confidence,
        });

        allTexts.push(ocrResult.text);
      }
      
      pageTexts = results;
      finalText = allTexts.join('\n\n');
      
      // Calculate average confidence
      const avgConfidence =
        results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
      finalConfidence = avgConfidence;
      
      // Combine with embedded text if mixed
      if (documentCategory === DocumentCategory.MIXED_PDF) {
        finalText = extractedText.text + '\n\n' + finalText;
      }
      
      this.logger.log(
        `OCR complete with average confidence: ${(finalConfidence * 100).toFixed(1)}%`,
      );
    }

    // Normalize text (Part 3: AI Pipeline - Text normalization)
    finalText = this.normalizeText(finalText);

    const processingTime = Date.now() - startTime;

    return {
      text: finalText,
      confidence: finalConfidence,
      documentCategory,
      pageCount: metadata.pageCount,
      pageTexts,
      metadata: {
        hasEmbeddedText: extractedText.hasEmbeddedText,
        processingMethod: documentCategory === DocumentCategory.TEXT_PDF
          ? 'embedded-text'
          : 'ocr',
        processingTime,
      },
    };
  }

  /**
   * Process an image document
   * @param buffer - Image file buffer
   * @param startTime - Processing start time
   * @param jobRecord - Optional job record for progress tracking (not used for images)
   * @returns OCR result
   */
  private async processImage(buffer: Buffer, startTime: number, jobRecord?: any): Promise<OcrResult> {
    this.logger.log('Processing image document');

    // Preprocess image
    const preprocessed = await this.imagePreprocessingService.preprocessImage(buffer);

    // Perform OCR
    const ocrResult = await this.tesseractService.performOcr(preprocessed);

    // Normalize text
    const normalizedText = this.normalizeText(ocrResult.text);

    const processingTime = Date.now() - startTime;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    if (jobRecord) {
      // Images are fast, no progress tracking needed
    }

    return {
      text: normalizedText,
      confidence: ocrResult.confidence,
      documentCategory: DocumentCategory.IMAGE_DOCUMENT,
      pageCount: 1,
      pageTexts: [
        {
          pageNumber: 1,
          text: normalizedText,
          confidence: ocrResult.confidence,
        },
      ],
      metadata: {
        hasEmbeddedText: false,
        processingMethod: 'ocr',
        processingTime,
      },
    };
  }

  /**
   * Normalize OCR text output
   * Part 3: AI Pipeline - Text normalization
   * @param text - Raw OCR text
   * @returns Normalized text
   */
  private normalizeText(text: string): string {
    return text
      // Remove excessive whitespace
      .replace(/\s+/g, ' ')
      // Remove duplicate newlines
      .replace(/\n{3,}/g, '\n\n')
      // Remove common OCR artifacts
      .replace(/[│|]/g, 'I')
      // Trim
      .trim();
  }

  /**
   * Check if OCR result requires cloud fallback
   * @param ocrResult - OCR result to check
   * @returns True if cloud OCR is recommended
   */
  requiresCloudFallback(ocrResult: OcrResult): boolean {
    // If Tesseract confidence is below threshold, recommend cloud OCR
    return !this.tesseractService.isQualityAcceptable(ocrResult.confidence);
  }

  /**
   * Normalize German number format (1.200,50 -> 1200.50)
   * Part 3: AI Pipeline - Currency normalization
   * @param text - Text containing numbers
   * @returns Text with normalized numbers
   */
  normalizeNumbers(text: string): string {
    return text
      // German format: 1.200,50 -> 1200.50
      .replace(/(\d+)\.(\d{3}),(\d{2})/g, '$1$2.$3')
      // German format: 1,50 -> 1.50
      .replace(/(\d+),(\d{2})/g, '$1.$2');
  }

  /**
   * Normalize dates to ISO format
   * Part 3: AI Pipeline - Date normalization
   * @param text - Text containing dates
   * @returns Text with normalized dates
   */
  normalizeDates(text: string): string {
    return text
      // German format: 10.03.2026 -> 2026-03-10
      .replace(/(\d{2})\.(\d{2})\.(\d{4})/g, '$3-$2-$1')
      // German format: 10.03.26 -> 2026-03-10 (assuming 20xx)
      .replace(/(\d{2})\.(\d{2})\.(\d{2})\b/g, (_match, day, month, year) => {
        const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
        return `${fullYear}-${month}-${day}`;
      });
  }
}
