import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { ProvidersModule } from './modules/providers/providers.module';
import { OrchestratorModule } from './modules/orchestrator/orchestrator.module';
import { BillingModule } from './modules/billing/billing.module';
import { CorpusApiModule } from './modules/corpus/corpus-api.module';
import { RagModule } from './modules/rag/rag.module';
import { MachineTokensModule } from './modules/machine-tokens/machine-tokens.module';
import { ConsultationModule } from './modules/consultation/consultation.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ClientModule } from './modules/billing/client.module';
import { DatabaseModule } from './database/database.module';
import { ProviderRegistryModule } from './providers/provider-registry.module';
import { EnvService } from './config/env';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CommonModule } from './common/common.module';
import { AuthJwtModule } from './security/jwt.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),
    DatabaseModule,
    CommonModule,
    AuthJwtModule,
    ProviderRegistryModule,
    AuditModule,
    HealthModule,
    AuthModule,
    ProvidersModule,
    OrchestratorModule,
    BillingModule,
    CorpusApiModule,
    RagModule,
    MachineTokensModule,
    NotificationsModule,
    ConsultationModule,
    ClientModule,
  ],
  providers: [
    EnvService,
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
  exports: [EnvService],
})
export class AppModule {}
