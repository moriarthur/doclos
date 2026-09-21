import { IsIn } from 'class-validator';
import { DocumentStatus } from '../entities/document.entity';

// P2-2 (audit): the PATCH /documents/:id body was read via @Body('status'),
// bypassing the ValidationPipe entirely. 'unarchive' moved to its own
// POST /documents/:id/unarchive endpoint.
const STATUS_VALUES = Object.values(DocumentStatus) as string[];

export class UpdateDocumentStatusDto {
  @IsIn(STATUS_VALUES)
  status: DocumentStatus;
}
