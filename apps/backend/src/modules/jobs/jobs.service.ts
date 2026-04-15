import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, JobStatus } from './entities/job.entity';
import { AuditLog } from './entities/audit-log.entity';

// Part 4: API Specification - Job status tracking

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job)
    private jobsRepository: Repository<Job>,
    @InjectRepository(AuditLog)
    private auditLogsRepository: Repository<AuditLog>,
  ) {}

  async getJobStatus(jobId: string) {
    const job = await this.jobsRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    // Use progress from job if available
    const progress = job.progress
      ? {
          current: job.progress.current || 0,
          total: job.progress.total || 0,
          percentage: job.progress.total
            ? Math.round(((job.progress.current || 0) / job.progress.total) * 100)
            : 50,
          message: job.progress.message,
          stage: job.progress.stage,
        }
      : {
          current: 0,
          total: 0,
          percentage: job.status === JobStatus.COMPLETED ? 100 : job.status === JobStatus.PROCESSING ? 50 : 0,
          message: job.status === JobStatus.COMPLETED ? 'Completed' : job.status === JobStatus.PROCESSING ? 'Processing...' : 'Pending',
          stage: job.status,
        };

    return {
      id: job.id,
      status: job.status,
      progress,
      error: job.last_error,
    };
  }

  async getDocumentJobs(documentId: string) {
    const jobs = await this.jobsRepository.find({
      where: { document_id: documentId },
      order: { created_at: 'DESC' },
      take: 1,
    });

    if (jobs.length === 0) {
      return null;
    }

    const job = jobs[0];
    const progress = job.progress
      ? {
          current: job.progress.current || 0,
          total: job.progress.total || 0,
          percentage: job.progress.total
            ? Math.round(((job.progress.current || 0) / job.progress.total) * 100)
            : 50,
          message: job.progress.message,
          stage: job.progress.stage,
        }
      : {
          current: 0,
          total: 0,
          percentage: job.status === JobStatus.COMPLETED ? 100 : job.status === JobStatus.PROCESSING ? 50 : 0,
          message: job.status === JobStatus.COMPLETED ? 'Completed' : job.status === JobStatus.PROCESSING ? 'Processing...' : 'Pending',
          stage: job.status,
        };

    return {
      id: job.id,
      status: job.status,
      progress,
      error: job.last_error,
    };
  }

  async cancelJob(jobId: string) {
    const job = await this.jobsRepository.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException('Job not found');
    }

    if (job.status !== JobStatus.PROCESSING && job.status !== JobStatus.PENDING) {
      throw new Error('Cannot cancel a job that is not processing or pending');
    }

    // Update job status to failed with cancellation message
    job.status = JobStatus.FAILED;
    job.last_error = 'Cancelled by user';
    await this.jobsRepository.save(job);

    // If job has a document, update document status to error
    if (job.document_id) {
      const { Document } = require('../documents/entities/document.entity');
      const { DataSource } = require('../../../database/data-source');
      const documentRepository = DataSource.getRepository(Document);

      await documentRepository.update(
        { id: job.document_id },
        { status: 'error' }
      );
    }

    return { message: 'Job cancelled successfully' };
  }

  async getAuditLogs(entityId?: string) {
    const qb = this.auditLogsRepository.createQueryBuilder('audit_log').leftJoinAndSelect('audit_log.user', 'user').orderBy('audit_log.created_at', 'DESC');

    if (entityId) {
      qb.andWhere('audit_log.entity_id = :entityId', { entityId });
    }

    return qb.getMany();
  }
}
