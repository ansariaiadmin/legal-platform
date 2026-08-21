import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { AuditModule } from './modules/audit/audit.module';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule, AuditModule, HealthModule, AuthModule],
})
export class AppModule {}
