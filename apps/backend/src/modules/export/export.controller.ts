import {
  Controller,
  Get,
  Query,
  Param,
  Res,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ExportQueryDto } from './dto/export-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Part 4: API Specification - Export endpoints
//
// Format-aware export. `excel` is implemented today; `csv`/`json` are reserved
// (the frontend dropdown already lists them as "coming soon") and rejected here
// with a clear message until their generators land.

const SUPPORTED_FORMATS = ['excel'] as const;
export type ExportFormat = (typeof SUPPORTED_FORMATS)[number];

@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private exportService: ExportService) {}

  /** List export — all of the user's invoices matching the filters (dashboard). */
  @Get(':format')
  async exportList(
    @CurrentUser() user: User,
    @Param('format') format: string,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    const fmt = this.resolveFormat(format);
    const ids = query.ids ? query.ids.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const buffer = await this.exportService.generateExcel(user.id, query, fmt, ids);
    this.sendWorkbook(res, buffer, 'doclos-invoices.xlsx');
  }

  /** Detail export — a single document's invoice report (Document Details page). */
  @Get('document/:id/:format')
  async exportDocument(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('format') format: string,
    @Res() res: Response,
  ) {
    const fmt = this.resolveFormat(format);
    const buffer = await this.exportService.generateDetailExcel(user.id, id, fmt);
    this.sendWorkbook(res, buffer, 'doclos-invoice.xlsx');
  }

  private resolveFormat(format: string): ExportFormat {
    if ((SUPPORTED_FORMATS as readonly string[]).includes(format)) {
      return format as ExportFormat;
    }
    throw new BadRequestException(
      `Format '${format}' is not available yet. Supported: ${SUPPORTED_FORMATS.join(', ')}.`,
    );
  }

  private sendWorkbook(res: Response, buffer: Buffer, filename: string) {
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }
}
