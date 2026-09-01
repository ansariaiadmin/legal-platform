import { Global, Module } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

/** Cross-cutting services available to every feature module. */
@Global()
@Module({
  providers: [RateLimitService],
  exports: [RateLimitService],
})
export class CommonModule {}
