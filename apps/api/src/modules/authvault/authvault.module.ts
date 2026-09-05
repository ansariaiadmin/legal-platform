import { Module } from '@nestjs/common';
import { MachineTokensModule } from '../machine-tokens/machine-tokens.module';
import { AreaLockService } from './area-lock.service';
import { PasskeysService } from './passkeys.service';
import { RotationService } from './rotation.service';
import { VaultController } from './vault.controller';

@Module({
  imports: [MachineTokensModule],
  controllers: [VaultController],
  providers: [AreaLockService, PasskeysService, RotationService],
  exports: [AreaLockService, PasskeysService, RotationService],
})
export class AuthVaultModule {}
