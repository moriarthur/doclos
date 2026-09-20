// P0-4 (audit): single source of truth for upload limits — shared by
// documents.controller (multer FileInterceptor options) and
// documents.service (defensive re-check before S3 upload).
export const UPLOAD_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'image/webp',
];

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB