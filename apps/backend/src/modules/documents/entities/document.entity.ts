// Part 2: Data Model - Documents table
// Part 3: AI Pipeline - Document processing states
import { Entity, Column, ManyToOne, OneToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../auth/entities/user.entity';
import { Customer } from './customer.entity';
import { Invoice } from './invoice.entity';

export enum DocumentType {
  INVOICE = 'invoice',
  CONTRACT = 'contract',
  OFFER = 'offer',
  DELIVERY_NOTE = 'delivery_note',
  PURCHASE_ORDER = 'purchase_order',
  UNKNOWN = 'unknown',
}

export enum DocumentStatus {
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  PARSED = 'parsed',
  NEEDS_VALIDATION = 'needs_validation',
  VALIDATED = 'validated',
  ARCHIVED = 'archived',
  ERROR = 'error',
}

@Entity('documents')
@Index(['user_id'])
@Index(['status'])
export class Document extends BaseEntity {
  @Column({ name: 'user_id' })
  user_id: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'customer_id', nullable: true })
  customer_id: string;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ name: 'invoiceId', nullable: true })
  invoiceId?: string;

  @OneToOne(() => Invoice, { nullable: true, cascade: true })
  @JoinColumn({ name: 'invoiceId' })
  invoice?: Invoice;

  @Column({ type: 'enum', enum: DocumentType, nullable: true })
  type: DocumentType;

  @Column({ type: 'enum', enum: DocumentStatus, default: DocumentStatus.UPLOADED })
  status: DocumentStatus;

  @Column({ name: 'previous_status', type: 'enum', enum: DocumentStatus, nullable: true })
  previous_status: DocumentStatus | null;

  @Column({ name: 'original_filename' })
  original_filename: string;

  @Column()
  s3_key: string;

  @Column()
  mime_type: string;

  @Column({ type: 'integer' })
  file_size: number;

  @Column({ type: 'integer', nullable: true })
  page_count: number;

  @Column({ type: 'timestamptz', nullable: true })
  processed_at: Date;
}
