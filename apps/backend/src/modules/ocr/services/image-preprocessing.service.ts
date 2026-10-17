import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { assertImageDimensions } from '../../../common/limits/processing-limits';

// Part 3: AI Pipeline - Image preprocessing for OCR
// Improves OCR accuracy by enhancing images

@Injectable()
export class ImagePreprocessingService {
  private readonly logger = new Logger(ImagePreprocessingService.name);

  /**
   * Preprocess an image for OCR
   * @param imageBuffer - Input image buffer
   * @returns Preprocessed image buffer
   */
  async preprocessImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      this.logger.debug('Preprocessing image for OCR');

      // PD-U4 (public-demo audit): decode-bounds check — a 30000×30000 JPEG
      // fits the upload byte cap but decompresses into gigabytes inside
      // sharp/Tesseract. Read the header and reject before any allocation.
      const meta = await sharp(imageBuffer).metadata();
      assertImageDimensions({ width: meta.width, height: meta.height });

      let pipeline = sharp(imageBuffer);

      // 1. Convert to grayscale
      pipeline = pipeline.grayscale();

      // 2. Normalize contrast and brightness
      pipeline = pipeline.normalize();

      // 3. Apply thresholding (binarization)
      pipeline = pipeline.threshold(128);

      // 4. Remove noise using median filter
      pipeline = pipeline.median(3);

      // 5. Sharpen the image
      pipeline = pipeline.sharpen();

      const processedBuffer = await pipeline.png().toBuffer();
      
      this.logger.debug('Image preprocessing complete');
      return processedBuffer;
    } catch (error) {
      this.logger.error(`Failed to preprocess image: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Deskew an image (correct rotation)
   * @param imageBuffer - Input image buffer
   * @returns Deskewed image buffer
   */
  async deskewImage(imageBuffer: Buffer): Promise<Buffer> {
    try {
      // TODO: Implement deskewing using image analysis
      // This is complex and may require additional libraries
      
      this.logger.debug('Deskewing image');
      return imageBuffer;
    } catch (error) {
      this.logger.error(`Failed to deskew image: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Enhance image for better OCR results
   * @param imageBuffer - Input image buffer
   * @param options - Enhancement options
   * @returns Enhanced image buffer
   */
  async enhanceImage(
    imageBuffer: Buffer,
    options: {
      dpi?: number;
      contrast?: number;
      brightness?: number;
    } = {},
  ): Promise<Buffer> {
    try {
      this.logger.debug('Enhancing image');

      let pipeline = sharp(imageBuffer);

      // Resize if DPI is too low
      // const targetDpi = options.dpi || 300;
      // TODO: Calculate resize based on current DPI

      // Adjust contrast
      if (options.contrast) {
        pipeline = pipeline.linear(options.contrast, -(128 * options.contrast) + 128);
      }

      // Adjust brightness
      if (options.brightness) {
        pipeline = pipeline.modulate({
          brightness: options.brightness,
        });
      }

      const enhancedBuffer = await pipeline.png().toBuffer();
      
      return enhancedBuffer;
    } catch (error) {
      this.logger.error(`Failed to enhance image: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Detect if an image has text content
   * @param imageBuffer - Input image buffer
   * @returns True if text is detected
   */
  async hasText(imageBuffer: Buffer): Promise<boolean> {
    try {
      // Simple heuristic: check if image has enough contrast variation
      const metadata = await sharp(imageBuffer).stats();

      // If standard deviation is very low, image is likely blank
      // Use the average stdev across all channels as a simple heuristic
      const avgStdev = metadata.channels.reduce((sum, ch) => sum + ch.stdev, 0) / metadata.channels.length;
      const hasContent = avgStdev > 10;

      this.logger.debug(`Text detection result: ${hasContent}`);
      return hasContent;
    } catch (error) {
      this.logger.error(`Failed to detect text: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
