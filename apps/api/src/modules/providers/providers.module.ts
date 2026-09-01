import { Module } from '@nestjs/common';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { ProvidersRepository } from './providers.repository';
import { EncryptionService } from '../../security/encryption.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [ProvidersController],
  providers: [ProvidersService, ProvidersRepository, EncryptionService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
