import { Controller, Delete, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { User } from './entities/user.entity';
import { AccountService } from './account.service';

// PD-T1 (public-demo audit): self-service account deletion — a public demo
// must let people erase their tenant. The controller answers once the DB
// transaction has committed; storage objects purge right after (with the
// retry queue as the safety net).
@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private accountService: AccountService) {}

  // Destructive and irreversible: a tight IP budget (rate limiter) plus the
  // guard chain (CSRF + JWT) is the abuse barrier.
  @Throttle({ default: { limit: 2, ttl: 3_600_000 } })
  @Delete()
  async deleteAccount(@CurrentUser() user: User) {
    const result = await this.accountService.deleteAccount(user.id);
    return {
      message: 'Account deleted',
      storage_objects_queued: result.queuedStorageKeys,
    };
  }
}
