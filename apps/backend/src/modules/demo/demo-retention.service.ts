import { Injectable, Logger, OnModuleDestroy, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { AccountService } from '../auth/account.service';

// PD-D3 (public-demo audit): retention cleanup for inactive accounts.
//
// On a public demo deployment, signups accumulate forever unless something
// reaps them. DEMO_RETENTION_DAYS (integer ≥ 1) enables a daily sweep that
// fully deletes accounts whose last login is older than the window — using
// the exact account-deletion path (transactional rows + storage retry
// queue), so retention can never leave half-deleted tenants.
//
// OFF by default: local development and any non-demo deployment keep every
// account. Document the recommended demo value (14) in .env.example. There
// are no "demo-flagged" accounts anymore — every account is self-registered,
// so the policy is uniform and stated in the product docs.
@Injectable()
export class DemoRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private static readonly MAX_PURGE_PER_RUN = 50;
  private static readonly INTERVAL_MS = 24 * 3_600_000;

  private readonly logger = new Logger(DemoRetentionService.name);
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly accountService: AccountService,
  ) {}

  private retentionDays(): number | null {
    const raw = process.env.DEMO_RETENTION_DAYS;
    if (raw === undefined || raw === '') return null;
    const days = Number(raw);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw new Error(`Invalid DEMO_RETENTION_DAYS: "${raw}" (expected integer 1-365)`);
    }
    return days;
  }

  onApplicationBootstrap(): void {
    if (this.retentionDays() === null) return;
    this.logger.log(`Demo retention enabled: accounts inactive for the configured window are deleted`);
    this.timer = setInterval(
      () => void this.sweep(),
      DemoRetentionService.INTERVAL_MS,
    );
    this.timer.unref();
    // Sweep once shortly after boot (delayed so startup isn't competing with it).
    setTimeout(() => void this.sweep(), 60_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async sweep(): Promise<number> {
    const days = this.retentionDays();
    if (days === null) return 0;
    const cutoff = new Date(Date.now() - days * 24 * 3_600_000);

    const inactive = await this.usersRepository.find({
      where: { last_login: LessThan(cutoff) },
      select: ['id'],
      take: DemoRetentionService.MAX_PURGE_PER_RUN,
    });

    let purged = 0;
    for (const user of inactive) {
      try {
        await this.accountService.deleteAccount(user.id);
        purged++;
      } catch (err) {
        // Never let one failing tenant block the rest; retried next sweep.
        this.logger.error(`Retention purge failed for user ${user.id}: ${(err as Error).message}`);
      }
    }
    if (purged > 0) {
      this.logger.log(`Retention sweep: purged ${purged} inactive account(s) (>${days}d)`);
    }
    return purged;
  }
}
