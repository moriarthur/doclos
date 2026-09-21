import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { UpdateDocumentStatusDto } from './dto/update-document-status.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';
import { DocumentType } from './entities/document.entity';
import { UPLOAD_MIME_TYPES, MAX_UPLOAD_BYTES } from './upload-constraints';

// Part 4: API Specification - Document endpoints

// Allowed upload MIME types + max size. Multer defaults to in-memory storage, so
// capping size bounds memory pressure (DoS hardening).
// Constants live in upload-constraints.ts (P0-4: shared with the service).

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (UPLOAD_MIME_TYPES.includes(file.mimetype)) return cb(null, true);
        return cb(
          new UnsupportedMediaTypeException(`Unsupported file type: ${file.mimetype}`),
          false,
        );
      },
    }),
  )
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @Body() body: { type?: DocumentType },
  ) {
    return this.documentsService.uploadDocument(file, user.id, body);
  }

  @Get()
  async listDocuments(@CurrentUser() user: User, @Query() query: ListDocumentsQueryDto) {
    return this.documentsService.listDocuments(user.id, {
      page: query.page,
      limit: query.limit,
      status: query.status,
      exclude_status: query.exclude_status,
      company: query.company,
      from_date: query.from_date ? new Date(query.from_date) : undefined,
      to_date: query.to_date ? new Date(query.to_date) : undefined,
    });
  }

  @Get(':id')
  async getDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.getDocument(id, user.id);
  }

  @Get(':id/file')
  async getDocumentFile(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Res() res: Response,
  ) {
    const { buffer, mimeType, filename } = await this.documentsService.getDocumentFile(id, user.id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Patch(':id/validate')
  async validateDocument(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: ValidateDocumentDto,
  ) {
    return this.documentsService.validateDocument(id, user.id, dto.fields);
  }

  @Post(':id/reprocess')
  async reprocessDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.reprocessDocument(id, user.id);
  }

  @Post(':id/unarchive')
  async unarchiveDocument(@Param('id') id: string, @CurrentUser() user: User) {
    return this.documentsService.unarchiveDocument(id, user.id);
  }

  @Patch(':id')
  async updateDocumentStatus(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @Body() dto: UpdateDocumentStatusDto,
  ) {
    return this.documentsService.updateDocumentStatus(id, user.id, dto.status);
  }

  @Delete(':id')
  async deleteDocument(@Param('id') id: string, @CurrentUser() user: User) {
    await this.documentsService.deleteDocument(id, user.id);
    return { message: 'Document deleted successfully' };
  }
}
