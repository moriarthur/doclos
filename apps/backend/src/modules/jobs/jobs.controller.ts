import { Controller, Get, Param, UseGuards, Query, Delete } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Get()
  async getJobs(@Query('document_id') documentId: string) {
    return this.jobsService.getDocumentJobs(documentId);
  }

  @Get(':id')
  async getJobStatus(@Param('id') id: string) {
    return this.jobsService.getJobStatus(id);
  }

  @Delete()
  async cancelByDocument(@Query('document_id') documentId: string) {
    return this.jobsService.cancelByDocument(documentId);
  }

  @Delete(':id')
  async cancelJob(@Param('id') id: string) {
    return this.jobsService.cancelJob(id);
  }
}
