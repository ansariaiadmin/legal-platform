import { Module } from '@nestjs/common';
import { AuthVaultModule } from '../authvault/authvault.module';
import { OpsController } from './ops.controller';
import { BackupService } from './backup.service';

@Module({
  // FIELD REVIEW #6: the ops surface (full-state backup/restore) gains the
  // area-lock step-up — the AuthVault module supplies the guard+service.
  imports: [AuthVaultModule],
  controllers: [OpsController],
  providers: [BackupService],
  exports: [BackupService],
})
export class OpsModule {}
