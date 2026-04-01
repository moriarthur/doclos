import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { ValidateDocumentDto } from './dto/validate-document.dto';
import { DocumentType } from './entities/document.entity';

// Part 4: API Specification - Document endpoints

@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @Body() body: { type?: DocumentType },
  ) {
    return this.documentsService.uploadDocument(file, user.id, body);
  }

  @Get()
  async listDocuments(
    @CurrentUser() user: User,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
    @Query('status') status?: string,
    @Query('company') company?: string,
    @Query('from_date') from_date?: string,
    @Query('to_date') to_date?: string,
  ) {
    return this.documentsService.listDocuments(user.id, {
      page,
      limit,
      status: status as any,
      company,
      from_date: from_date ? new Date(from_date) : undefined,
      to_date: to_date ? new Date(to_date) : undefined,
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
}
