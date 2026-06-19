import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ExportService } from './export.service';
import { ExportQueryDto } from './dto/export-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

// Part 4: API Specification - Export endpoints
@Controller('export')
@UseGuards(JwtAuthGuard)
export class ExportController {
  constructor(private exportService: ExportService) {}

  @Get('excel')
  async exportExcel(
    @CurrentUser() user: User,
    @Query() query: ExportQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.exportService.generateExcel(user.id, query);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="doclos-invoices.xlsx"');
    res.send(buffer);
  }
}
