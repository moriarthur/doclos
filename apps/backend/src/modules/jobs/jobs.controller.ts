import { Controller, Get, Param, UseGuards, Query, Delete } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// Part 4: API Specification - Job status endpoint

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Get(':id')
  async getJobStatus(@Param('id') id: string) {
    return this.jobsService.getJobStatus(id);
  }

  @Get()
  async getJobs(@Query('document_id') documentId: string) {
    return this.jobsService.getDocumentJobs(documentId);
  }

  @Delete(':id')
  async cancelJob(@Param('id') id: string) {
    return this.jobsService.cancelJob(id);
  }
}
