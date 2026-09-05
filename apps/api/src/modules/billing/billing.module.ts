import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { WalletService } from './wallet.service';
import { PgWalletService } from './pg-wallet.service';
import { BillingService } from './billing.service';
import { ProviderRegistryModule } from '../../providers/provider-registry.module';
import { PAYMENT_PROVIDER, STORAGE_PROVIDER } from '../../providers/provider.tokens';

/**
 * Money brain (P2a→P12): the wallet switches itself to the Postgres LEDGER
 * (row-locked, cross-replica safe, append-only) the moment DATABASE_URL is
 * real; without it the honest JSON prototype serves the sandbox and the
 * preflight gate refuses real gateways (P11.5).
 */
@Module({
  imports: [ProviderRegistryModule, ConfigModule],
  providers: [
    {
      provide: WalletService,
      useFactory: (
        payment: never,
        storage: never,
        config: ConfigService,
        pool: Pool,
      ) =>
        config.get<string>('DATABASE_URL')
          ? (new PgWalletService(payment, pool) as unknown as WalletService)
          : new WalletService(payment, storage),
      inject: [PAYMENT_PROVIDER, STORAGE_PROVIDER, ConfigService, Pool],
    },
    PgWalletService,
    BillingService,
  ],
  exports: [WalletService, BillingService],
})
export class BillingModule {}
