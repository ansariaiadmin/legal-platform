import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RateLimitService } from './rate-limit.service';
import { RedisRateLimitService, pickRateLimiterDriver } from './redis-rate-limit.service';

/** Cross-cutting services available to every feature module. */
@Global()
@Module({
  providers: [
    RateLimitService,
    {
      // P10-T-floor: real shared instance ONLY when honestly configured —
      // otherwise the token resolves to null and the floor stays in-process.
      provide: RedisRateLimitService,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        pickRateLimiterDriver(config) === 'redis' ? new RedisRateLimitService(config) : null,
    },
  ],
  exports: [RateLimitService, RedisRateLimitService],
})
export class CommonModule {}
