import { Controller, Get, Param, UseGuards, Query, Delete } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';

@Controller('jobs')
@UseGuards(JwtAuthGuard)
export class JobsController {
  constructor(private jobsService: JobsService) {}

  @Get()
  async getJobs(@Query('document_id') documentId: string, @CurrentUser() user: User) {
    return this.jobsService.getDocumentJobs(documentId, user.id);
  }

  @Get(':id')
  async getJobStatus(@Param('id') id: string, @CurrentUser() user: User) {
    return this.jobsService.getJobStatus(id, user.id);
  }

  @Delete()
  async cancelByDocument(@Query('document_id') documentId: string, @CurrentUser() user: User) {
    return this.jobsService.cancelByDocument(documentId, user.id);
  }

  @Delete(':id')
  async cancelJob(@Param('id') id: string, @CurrentUser() user: User) {
    return this.jobsService.cancelJob(id, user.id);
  }
}
