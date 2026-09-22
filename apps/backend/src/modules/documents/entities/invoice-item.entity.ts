// Part 2: Data Model - Invoice Items table
import { Entity, Column, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { Invoice } from './invoice.entity';

@Entity('invoice_items')
export class InvoiceItem extends BaseEntity {
  @Column({ name: 'invoice_id' })
  invoice_id: string;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;

  // Nullable columns are union-typed with an explicit @Column type — the
  // reflected design:type of a union is Object, which crashes boot otherwise
  // (project coding standard).
  @Column({ type: 'text', nullable: true })
  description: string | null;

  // U-4: quantity unit (Stück, Stk., Std., m, kg, ...) — extracted by GLM and
  // editable in the validation UI. Null when the document states none.
  @Column({ type: 'text', nullable: true })
  unit: string | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  quantity: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  unit_price: number | null;

  @Column({ type: 'numeric', precision: 10, scale: 2, nullable: true })
  line_total: number | null;
}
