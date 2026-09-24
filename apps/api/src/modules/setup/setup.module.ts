import { Module } from '@nestjs/common';
import { SetupWizardService } from './setup.service';
import { SetupController } from './setup.controller';

@Module({
  controllers: [SetupController],
  providers: [SetupWizardService],
  exports: [SetupWizardService],
})
export class SetupModule {}
