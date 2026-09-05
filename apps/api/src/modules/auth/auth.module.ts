import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { RolesGuard } from '../../security/roles.guard';
import { AuthVaultModule } from '../authvault/authvault.module';

@Module({
  imports: [AuthVaultModule], // P12-i: passkey-first login needs the vault's ceremony service
  controllers: [AuthController],
  providers: [AuthService, JwtAccessGuard, RolesGuard],
  exports: [AuthService, JwtAccessGuard, RolesGuard],
})
export class AuthModule {}
