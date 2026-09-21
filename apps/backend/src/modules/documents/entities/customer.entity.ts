// Part 2: Data Model - Customers table
import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from '../../auth/entities/user.entity';

@Entity('customers')
@Index(['user_id', 'name'])
export class Customer extends BaseEntity {
  // P0-2 (audit): customers are per-tenant; nullable only for legacy rows
  // left unattributed by scripts/backfill-customer-user-id.cjs
  @Column({ name: 'user_id', nullable: true, type: 'varchar' })
  user_id: string | null;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column()
  name: string;

  @Column({ nullable: true })
  tax_id: string;

  @Column({ nullable: true })
  vat_id: string;

  @Column({ nullable: true })
  address: string;

  @Column({ nullable: true })
  city: string;

  @Column({ nullable: true })
  country: string;
}
