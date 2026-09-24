import { Module } from '@nestjs/common';
import { ConsultationQueueService } from './queue.service';
import { TelecomsController } from './telecoms.controller';
import { BillingModule } from '../billing/billing.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * Telecoms + queue (P2a): ticket lifecycle driven by the lawyer's toggles;
 * notifications fan out in-app / SMS / outbound call via wired panels —
 * that's why notifications come IN here.
 */
@Module({
  imports: [BillingModule, NotificationsModule],
  controllers: [TelecomsController],
  providers: [ConsultationQueueService],
  exports: [ConsultationQueueService],
})
export class ConsultationModule {}
