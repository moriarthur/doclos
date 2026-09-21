// Part 2: Data Model - Invoices table
import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Document } from './document.entity';

@Entity('invoices')
@Index(['invoice_number'])
@Index(['invoice_date'])
export class Invoice extends BaseEntity {
  @Column({ name: 'document_id' })
  document_id: string;

  @ManyToOne(() => Document)
  @JoinColumn({ name: 'document_id' })
  document: Document;

  // Column types mirror the DB: nullable columns are `| null` (P2-1 lets
  // validation clear fields, so the types must allow it)
  @Column({ nullable: true })
  invoice_number: string | null;

  @Column({ type: 'date', nullable: true })
  invoice_date: Date | null;

  @Column({ type: 'date', nullable: true })
  due_date: Date | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  amount_total: number | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  vat_amount: number | null;

  @Column({ default: 'EUR' })
  currency: string;

  @Column({ nullable: true })
  supplier_name: string | null;

  @Column({ nullable: true })
  supplier_address: string | null;

  @Column({ default: false })
  validated: boolean;
}
