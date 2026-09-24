import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CommsSettingsService } from './comms-settings.service';
import { CommsController } from './comms.controller';
import { ProviderRegistryModule } from '../../providers/provider-registry.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [ProviderRegistryModule, AuditModule],
  controllers: [CommsController],
  providers: [NotificationService, CommsSettingsService],
  exports: [NotificationService, CommsSettingsService],
})
export class NotificationsModule {}
