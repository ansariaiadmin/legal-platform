import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProviderConfig } from './entities/provider-config.entity';
import { EncryptionService } from '../../security/encryption.service';
import { ConfigService } from '@nestjs/config';
import { MockSmsAdapter } from '../../providers/sms/mock-sms.adapter';
import { MockPaymentAdapter } from '../../providers/payment/mock-payment.adapter';
import { MockAIAdapter } from '../../providers/ai/mock-ai.adapter';
import { MockTelephonyAdapter } from '../../providers/telephony/mock-telephony.adapter';
import { MockPushAdapter } from '../../providers/push/mock-push.adapter';
import { LocalStorageAdapter } from '../../providers/storage/local-storage.adapter';

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(ProviderConfig)
    private readonly repo: Repository<ProviderConfig>,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async findAll(): Promise<ProviderConfig[]> {
    return this.repo.find();
  }

  async findOne(id: string): Promise<ProviderConfig> {
    const config = await this.repo.findOne({ where: { id } });
    if (!config) {
      throw new NotFoundException(`Provider config ${id} not found`);
    }
    return config;
  }

  async resolveProvider<T>(providerType: string): Promise<T | null> {
    const config = await this.repo.findOne({
      where: { providerType, isActive: true },
    });

    if (!config) {
      // Fall back to env-based mock in development only
      const envProvider = this.configService.get<string>(`${providerType.toUpperCase()}_PROVIDER`);
      if (envProvider === 'mock' && process.env.NODE_ENV !== 'production') {
        return this.createMockAdapter(providerType) as T;
      }
      return null;
    }

    return this.createAdapter(config) as T;
  }

  async updateConfig(id: string, updates: Partial<ProviderConfig>): Promise<ProviderConfig> {
    const entity = await this.findOne(id);
    Object.assign(entity, updates);
    await this.repo.save(entity);
    return entity;
  }

  async setFallback(providerId: string, fallbackId: string | null): Promise<void> {
    const entity = await this.findOne(providerId);
    entity.fallbackProviderConfigId = fallbackId;
    await this.repo.save(entity);
  }

  async checkHealth(config: ProviderConfig): Promise<{ valid: boolean; error?: string }> {
    const adapter = this.createAdapter(config);
    if (adapter && typeof (adapter as any).verifyConfig === 'function') {
      return (adapter as any).verifyConfig();
    }
    return { valid: false, error: 'Adapter does not support health check' };
  }

  encryptSecrets(secrets: Record<string, string>): string {
    const json = JSON.stringify(secrets);
    return this.encryptionService.encrypt(json);
  }

  decryptSecrets(encrypted: string): Record<string, string> {
    const json = this.encryptionService.decrypt(encrypted);
    return JSON.parse(json);
  }

  private createAdapter(config: ProviderConfig): unknown {
    switch (config.providerType) {
      case 'sms':
        return new MockSmsAdapter();
      case 'payment':
        return new MockPaymentAdapter();
      case 'ai':
        return new MockAIAdapter(this.configService);
      case 'telephony':
        return new MockTelephonyAdapter();
      case 'push':
        return new MockPushAdapter();
      case 'storage':
        return new LocalStorageAdapter(this.configService);
      default:
        throw new Error(`Unknown provider type: ${config.providerType}`);
    }
  }

  private createMockAdapter(providerType: string): unknown {
    switch (providerType) {
      case 'sms':
        return new MockSmsAdapter();
      case 'payment':
        return new MockPaymentAdapter();
      case 'ai':
        return new MockAIAdapter(this.configService);
      case 'telephony':
        return new MockTelephonyAdapter();
      case 'push':
        return new MockPushAdapter();
      case 'storage':
        return new LocalStorageAdapter(this.configService);
      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }
  }
}
