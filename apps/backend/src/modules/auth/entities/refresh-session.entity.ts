// PD-A2 (public-demo audit): server-side refresh sessions. Only the SHA-256
// hash of the refresh token is stored — a DB leak must never yield usable
// tokens. Rotation revokes the old row; reuse of a revoked token revokes the
// whole user's chain (theft detection).
import { Entity, Column, Index, ManyToOne, JoinColumn } from 'typeorm';
import { BaseEntity } from '../../../database/base.entity';
import { User } from './user.entity';

@Entity('refresh_sessions')
@Index(['token_hash'], { unique: true })
@Index(['user_id'])
export class RefreshSession extends BaseEntity {
  @Column({ name: 'user_id', type: 'uuid' })
  user_id: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  // sha256 hex of the raw refresh token (64 chars)
  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  token_hash: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expires_at: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revoked_at: Date | null;

  // When this session was last refreshed (rotation trace).
  @Column({ name: 'last_used_at', type: 'timestamptz', nullable: true })
  last_used_at: Date | null;
}
