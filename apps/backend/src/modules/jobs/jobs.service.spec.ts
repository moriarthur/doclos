// P0-1 / P2-13 (audit): ownership guard on the Jobs API — a job or document
// belonging to another user must be invisible (404), and cancel must not
// sabotage foreign data.
import { Test } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JobsService } from './jobs.service';
import { Job, JobStatus } from './entities/job.entity';
import { AuditLog } from './entities/audit-log.entity';
import { Document, DocumentStatus } from '../documents/entities/document.entity';

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';
const DOC_A = 'doc-a';
const JOB_ID = 'job-1';

const makeJob = (overrides: Record<string, unknown> = {}): Job =>
  ({
    id: JOB_ID,
    document_id: DOC_A,
    status: JobStatus.PROCESSING,
    progress: null,
    last_error: null,
    ...overrides,
  } as unknown as Job);

describe('JobsService ownership guard (P0-1)', () => {
  let service: JobsService;
  let jobsRepo: { findOne: jest.Mock; save: jest.Mock };
  let documentsRepo: { findOne: jest.Mock; update: jest.Mock };
  let auditRepo: { save: jest.Mock };

  beforeEach(async () => {
    jobsRepo = { findOne: jest.fn(), save: jest.fn() };
    documentsRepo = { findOne: jest.fn(), update: jest.fn() };
    auditRepo = { save: jest.fn() };

    const moduleRef = await Test.createTestingModule({
      providers: [
        JobsService,
        { provide: getRepositoryToken(Job), useValue: jobsRepo },
        { provide: getRepositoryToken(AuditLog), useValue: auditRepo },
        { provide: getRepositoryToken(Document), useValue: documentsRepo },
      ],
    }).compile();

    service = moduleRef.get(JobsService);
  });

  describe('getJobStatus', () => {
    it('returns job data to the owning user', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob());
      documentsRepo.findOne.mockResolvedValue({ id: DOC_A, user_id: USER_A });

      const result = await service.getJobStatus(JOB_ID, USER_A);
      expect(result.id).toBe(JOB_ID);
    });

    it('returns 404 when the document belongs to another user', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob());
      documentsRepo.findOne.mockResolvedValue(null); // scoped by user_id -> miss

      await expect(service.getJobStatus(JOB_ID, USER_B)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 for a job without a document', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ document_id: null }));

      await expect(service.getJobStatus(JOB_ID, USER_A)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelJob', () => {
    it('rejects cancelling with BadRequest when job is not active', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ status: JobStatus.COMPLETED }));
      documentsRepo.findOne.mockResolvedValue({ id: DOC_A, user_id: USER_A });

      await expect(service.cancelJob(JOB_ID, USER_A)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("returns 404 when cancelling another user's job", async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob());
      documentsRepo.findOne.mockResolvedValue(null);

      await expect(service.cancelJob(JOB_ID, USER_B)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('cancelByDocument', () => {
    it('is a no-op when the latest job is not active (P2-3)', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ status: JobStatus.COMPLETED }));
      documentsRepo.findOne.mockResolvedValue({ id: DOC_A, user_id: USER_A });

      const result = await service.cancelByDocument(DOC_A, USER_A);

      expect(result.message).toContain('No active job');
      expect(jobsRepo.findOne).toHaveBeenCalled();
      expect(documentsRepo.update).not.toHaveBeenCalled();
    });

    it('cancels the active job and marks the document as error', async () => {
      jobsRepo.findOne.mockResolvedValue(makeJob({ status: JobStatus.PENDING }));
      documentsRepo.findOne.mockResolvedValue({ id: DOC_A, user_id: USER_A });

      const result = await service.cancelByDocument(DOC_A, USER_A);

      expect(result.message).toContain('cancelled');
      expect(documentsRepo.update).toHaveBeenCalledWith(
        { id: DOC_A },
        { status: DocumentStatus.ERROR },
      );
    });
  });
});
