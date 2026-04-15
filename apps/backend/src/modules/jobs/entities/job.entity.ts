// Part 2: Data Model - Jobs table for background processing tracking
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Document } from '../../documents/entities/document.entity';

export enum JobType {
  PROCESS_DOCUMENT = 'process_document',
  RUN_OCR = 'run_ocr',
  LLM_PARSE = 'llm_parse',
  GENERATE_EXCEL = 'generate_excel',
  REPROCESS_DOCUMENT = 'reprocess_document',
}

export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('jobs')
export class Job extends BaseEntity {
  @Column({ type: 'enum', enum: JobType })
  job_type: JobType;

  @Column({ type: 'enum', enum: JobStatus, default: JobStatus.PENDING })
  status: JobStatus;

  @Column({ name: 'document_id', nullable: true })
  document_id: string;

  @ManyToOne(() => Document, { nullable: true })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  @Column({ type: 'integer', default: 0 })
  attempts: number;

  @Column({ type: 'text', nullable: true })
  last_error: string;

  @Column({ type: 'json', nullable: true })
  progress: {
    current?: number;
    total?: number;
    message?: string;
    stage?: 'downloading' | 'ocr' | 'classifying' | 'extracting' | 'completed';
  };
}
