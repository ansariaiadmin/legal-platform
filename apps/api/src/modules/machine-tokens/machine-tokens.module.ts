import { Module } from '@nestjs/common';
import { MachineTokensService } from './machine-tokens.service';
import { MachineTokenGuard } from './machine-token.guard';
import { MachineTokensController } from './machine-tokens.controller';
import { ExtPingController } from './ext-ping.controller';

@Module({
  controllers: [MachineTokensController, ExtPingController],
  providers: [MachineTokensService, MachineTokenGuard],
  exports: [MachineTokensService, MachineTokenGuard],
})
export class MachineTokensModule {}
