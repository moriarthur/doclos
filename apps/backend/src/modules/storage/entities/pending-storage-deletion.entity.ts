// PD-T1 (public-demo audit): storage objects of deleted accounts must go
// too, but an S3 delete can fail after the DB transaction already committed.
// Rows here ARE the retry queue: the account-delete transaction inserts the
// keys in the same commit that erases the user; the boot/interval sweeper
// purges the objects and removes the rows. Backlog visible in the table,
// retry automatic — no silent orphans.
import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';

@Entity('pending_storage_deletions')
@Index(['s3_key'], { unique: true })
export class PendingStorageDeletion extends BaseEntity {
  @Column({ name: 's3_key', type: 'varchar', length: 512 })
  s3_key: string;

  // Bounded retry bookkeeping: how many sweeps attempted this key.
  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;
}
