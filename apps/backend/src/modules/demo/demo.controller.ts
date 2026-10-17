import { Controller, Post, Delete, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../auth/entities/user.entity';
import { DemoService } from './demo.service';

// PD-D1 (public-demo audit): per-user synthetic sample — the replacement for
// the retired shared demo account. Authentication + CSRF + both rate layers
// (IP here, per-user quota in the service) guard the GLM/storage budget.
@Controller('demo')
@UseGuards(JwtAuthGuard)
export class DemoController {
  constructor(private demoService: DemoService) {}

  // Spec budget: 2/hour/IP for the sample endpoint; the user-level quota
  // (1/day) is the tighter of the two in practice.
  @Throttle({ default: { limit: 2, ttl: 3_600_000 } })
  @Post('sample')
  async createSample(@CurrentUser() user: User) {
    return this.demoService.createSample(user.id);
  }

  // Reset only ever touches the caller's own synthetic documents.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Delete('sample')
  async resetSample(@CurrentUser() user: User) {
    return this.demoService.resetSample(user.id);
  }
}
