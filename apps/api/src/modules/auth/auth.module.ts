import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DatabaseModule } from '../../database/database.module';
import { AuditModule } from '../audit/audit.module';
import { MockSmsAdapter } from '../../providers/sms/mock-sms.adapter';

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    JwtModule.register({
      secret: process.env.JWT_ACCESS_SECRET || 'dev-secret',
      signOptions: { expiresIn: '15m' },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    {
      provide: Symbol('SmsProvider'),
      useClass: MockSmsAdapter,
    },
  ],
  exports: [AuthService],
})
export class AuthModule {}
