import { Module } from '@nestjs/common';
import { ClientController } from './client.controller';
import { BillingModule } from './billing.module';
import { ConsultationModule } from '../consultation/consultation.module';
import { NotificationsModule } from '../notifications/notifications.module';

/** The public site's surface — wallet, shop, queue, notifications (P2a). */
@Module({
  imports: [BillingModule, ConsultationModule, NotificationsModule],
  controllers: [ClientController],
})
export class ClientModule {}
