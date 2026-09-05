import { Module } from '@nestjs/common';
import { OpsController } from './ops.controller';
import { BackupService } from './backup.service';

@Module({
  controllers: [OpsController],
  providers: [BackupService],
  exports: [BackupService],
})
export class OpsModule {}
