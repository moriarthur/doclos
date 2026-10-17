import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';
import { HealthController } from './health.controller';

@Module({
  imports: [
    // PD-H1: /readyz pings the documents queue's Redis connection.
    BullModule.registerQueue({ name: 'documents' }),
  ],
  controllers: [HealthController],
})
export class HealthModule {}
