import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OcrService } from './services/ocr.service';
import { PdfService } from './services/pdf.service';
import { ImagePreprocessingService } from './services/image-preprocessing.service';
import { TesseractService } from './services/tesseract.service';
import { Job } from '../jobs/entities/job.entity';

// Part 3: AI Pipeline - OCR processing module
// Handles text extraction from PDFs and images

@Module({
  imports: [TypeOrmModule.forFeature([Job])],
  providers: [
    OcrService,
    PdfService,
    ImagePreprocessingService,
    TesseractService,
  ],
  exports: [
    OcrService,
    PdfService,
    ImagePreprocessingService,
    TesseractService,
  ],
})
export class OcrModule {}
