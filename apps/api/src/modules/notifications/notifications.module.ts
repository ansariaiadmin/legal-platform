import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CommsController } from './comms.controller';
import { ProviderRegistryModule } from '../../providers/provider-registry.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ProviderRegistryModule, AuditModule],
  controllers: [CommsController],
  // CommsSettingsService comes from the global ProviderRegistryModule, because
  // the SMS provider itself depends on it.
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationsModule {}
