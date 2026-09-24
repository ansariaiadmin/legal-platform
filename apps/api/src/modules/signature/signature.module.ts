import { Module } from '@nestjs/common';
import { SignatureService } from './signature.service';
import { SignatureController } from './signature.controller';
import { ProviderRegistryModule } from '../../providers/provider-registry.module';

@Module({
  imports: [ProviderRegistryModule],
  controllers: [SignatureController],
  providers: [SignatureService],
  exports: [SignatureService],
})
export class SignatureModule {}
