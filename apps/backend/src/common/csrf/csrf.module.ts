import { Module } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

@Module({
  providers: [CsrfGuard],
  exports: [CsrfGuard],
})
export class CsrfModule {}
