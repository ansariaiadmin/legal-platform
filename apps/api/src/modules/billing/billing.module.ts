import { Module } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { BillingService } from './billing.service';
import { ProviderRegistryModule } from '../../providers/provider-registry.module';

/**
 * Money brain (P2a): wallet (StorageProvider-persisted), catalog of
 * consultation minutes + AI subscription features, purchases consumed by the
 * queue. The PaymentProvider port ships a mock adapter in dev and REAL
 * gateway wiring behind verifyConfig in production (SPEC §2 — ports only).
 */
@Module({
  imports: [ProviderRegistryModule],
  providers: [WalletService, BillingService],
  exports: [WalletService, BillingService],
})
export class BillingModule {}
