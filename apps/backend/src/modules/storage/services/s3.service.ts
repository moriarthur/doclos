import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

// Part 4: API Specification - S3 storage integration
// Part 8: Infrastructure & Deployment - Object storage

@Injectable()
export class S3Service {
  private readonly logger = new Logger(S3Service.name);
  private readonly client: S3Client;
  private readonly bucketName: string;
  private readonly region: string;
  private readonly endpoint?: string;

  constructor(private configService: ConfigService) {
    this.region = this.configService.get('S3_REGION') || 'auto';
    this.endpoint = this.configService.get('S3_ENDPOINT');
    this.bucketName = this.configService.get('S3_BUCKET') || 'doclos-documents';

    // Initialize S3 client
    // Supports both AWS S3 and Cloudflare R2 (via custom endpoint)
    this.client = new S3Client({
      region: this.region,
      endpoint: this.endpoint,
      credentials: {
        accessKeyId: this.configService.get('S3_ACCESS_KEY_ID') || '',
        secretAccessKey: this.configService.get('S3_SECRET_ACCESS_KEY') || '',
      },
    });

    this.logger.log(`S3 Service initialized with bucket: ${this.bucketName}`);
    if (this.endpoint) {
      this.logger.log(`Using custom endpoint: ${this.endpoint}`);
    }
  }

  /**
   * Upload a file to S3
   * @param key - The S3 key (path) for the file
   * @param buffer - File buffer
   * @param mimeType - Content type of the file
   * @returns The S3 key of the uploaded file
   */
  async uploadFile(key: string, buffer: Buffer, mimeType: string): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimeType,
        // Server-side encryption (Part 7: Security & GDPR)
        ServerSideEncryption: 'AES256',
      });

      await this.client.send(command);
      this.logger.log(`File uploaded: ${key}`);
      return key;
    } catch (error) {
      this.logger.error(`Failed to upload file: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Download a file from S3
   * @param key - The S3 key of the file to download
   * @returns The file buffer
   */
  async downloadFile(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.client.send(command);

      // Convert stream to buffer
      const stream = response.Body as Readable;
      const chunks: Uint8Array[] = [];

      return new Promise((resolve, reject) => {
        stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
      });
    } catch (error) {
      this.logger.error(`Failed to download file: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Generate a presigned URL for downloading a file
   * @param key - The S3 key of the file
   * @param expiresIn - URL expiration time in seconds (default: 24 hours)
   * @returns The presigned URL
   */
  async getSignedUrl(key: string, expiresIn: number = 86400): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(this.client, command, { expiresIn });
      this.logger.debug(`Generated signed URL for: ${key}`);
      return url;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Delete a file from S3
   * @param key - The S3 key of the file to delete
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
      this.logger.log(`File deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete file: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Check if a file exists in S3
   * @param key - The S3 key to check
   * @returns True if the file exists
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      // P2-5 (audit): HeadObject instead of GetObject — no point streaming the
      // whole object just to learn whether it exists
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      await this.client.send(command);
      return true;
    } catch (error) {
      if (error instanceof Error && 'name' in error) {
        if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
          return false;
        }
      }
      if (error && typeof error === 'object' && '$metadata' in error) {
        const metadata = (error as { $metadata: { httpStatusCode?: number } }).$metadata;
        if (metadata.httpStatusCode === 404) {
          return false;
        }
      }
      throw error;
    }
  }

  /**
   * Get the public URL for a file (if bucket is public)
   * Note: For private buckets, use getSignedUrl instead
   * @param key - The S3 key of the file
   * @returns The public URL
   */
  getPublicUrl(key: string): string {
    if (this.endpoint) {
      // Cloudflare R2 or custom endpoint
      return `${this.endpoint}/${this.bucketName}/${key}`;
    }
    // AWS S3
    return `https://${this.bucketName}.s3.${this.region}.amazonaws.com/${key}`;
  }
}
