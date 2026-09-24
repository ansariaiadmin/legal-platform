import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { RootController } from './root.controller';
import { MetricsService } from './metrics.service';
import { AlertingService } from './alerting.service';

@Module({
  controllers: [HealthController, RootController],
  providers: [MetricsService, AlertingService],
  exports: [MetricsService, AlertingService],
})
export class HealthModule {}
