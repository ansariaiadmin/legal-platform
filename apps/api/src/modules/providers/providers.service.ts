import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ERROR_CODES } from '@legal-platform/contracts';
import { ProvidersRepository, type ProviderConfigView } from './providers.repository';
import { EncryptionService } from '../../security/encryption.service';
import { createAdapterFor, adapterKeyFromEnv } from '../../providers/provider.factory';
import { isHealthCheckable, type HealthCheckResult } from '../../providers/health-checkable';
import type { ProviderCategory } from '../../providers/provider.tokens';
import type { CreateProviderConfigDto, UpdateProviderConfigDto } from './dto/provider-config.dto';

export interface ResolvedProvider {
  adapter: unknown;
  config: ProviderConfigView | null;
  source: 'database' | 'environment';
}

/**
 * CRUD + health for the `provider_configs` table (SPEC section 8).
 *
 * Secrets are encrypted before they touch the database and are never returned
 * to any caller; every mutation is written to the audit log by the controller.
 */
@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly repository: ProvidersRepository,
    private readonly encryptionService: EncryptionService,
    private readonly configService: ConfigService,
  ) {}

  async list(): Promise<ProviderConfigView[]> {
    const rows = await this.repository.findAll();
    return rows.map((row) => this.repository.toView(row));
  }

  async get(id: string): Promise<ProviderConfigView> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException(ERROR_CODES.PROVIDER_NOT_FOUND);
    }
    return this.repository.toView(row);
  }

  async create(dto: CreateProviderConfigDto): Promise<ProviderConfigView> {
    const row = await this.repository.create({
      providerType: dto.providerType,
      adapterKey: dto.adapterKey,
      config: dto.config ?? {},
      encryptedSecrets: dto.secrets ? this.encryptSecrets(dto.secrets) : null,
      isActive: dto.isActive ?? false,
    });
    return this.repository.toView(row);
  }

  async update(id: string, dto: UpdateProviderConfigDto): Promise<ProviderConfigView> {
    await this.get(id);

    const row = await this.repository.update(id, {
      adapterKey: dto.adapterKey,
      config: dto.config,
      encryptedSecrets: dto.secrets ? this.encryptSecrets(dto.secrets) : undefined,
      isActive: dto.isActive,
    });

    if (!row) {
      throw new NotFoundException(ERROR_CODES.PROVIDER_NOT_FOUND);
    }
    return this.repository.toView(row);
  }

  async setFallback(providerId: string, fallbackId: string | null): Promise<ProviderConfigView> {
    const primary = await this.get(providerId);

    if (fallbackId !== null) {
      if (fallbackId === providerId) {
        throw new BadRequestException('VALIDATION_INVALID_INPUT');
      }
      const fallback = await this.get(fallbackId);
      if (fallback.providerType !== primary.providerType) {
        throw new BadRequestException('VALIDATION_INVALID_INPUT');
      }
    }

    const row = await this.repository.update(providerId, { fallbackProviderConfigId: fallbackId });
    if (!row) {
      throw new NotFoundException(ERROR_CODES.PROVIDER_NOT_FOUND);
    }
    return this.repository.toView(row);
  }

  async testConnection(id: string): Promise<HealthCheckResult> {
    const row = await this.repository.findById(id);
    if (!row) {
      throw new NotFoundException(ERROR_CODES.PROVIDER_NOT_FOUND);
    }

    let result: HealthCheckResult;
    try {
      const adapter = this.buildAdapter(row.provider_type as ProviderCategory, row.adapter_key);
      result = isHealthCheckable(adapter)
        ? await adapter.verifyConfig()
        : { valid: false, error: 'Adapter does not support health checks' };
    } catch (error) {
      result = { valid: false, error: error instanceof Error ? error.message : 'Health check failed' };
    }

    await this.repository.recordHealth(id, result.valid ? 'healthy' : 'unhealthy');
    return result;
  }

  async healthSummary(): Promise<Array<ProviderConfigView & HealthCheckResult>> {
    const rows = await this.repository.findAll();
    const results: Array<ProviderConfigView & HealthCheckResult> = [];

    for (const row of rows) {
      const health = await this.testConnection(row.id);
      results.push({ ...this.repository.toView(row), ...health });
    }

    return results;
  }

  /**
   * Returns the adapter for a category, preferring the active database config
   * and falling back to the environment-selected adapter (mock in development).
   */
  async resolveAdapter(category: ProviderCategory): Promise<ResolvedProvider | null> {
    const row = await this.repository.findActiveByType(category);
    if (row) {
      return {
        adapter: this.buildAdapter(category, row.adapter_key),
        config: this.repository.toView(row),
        source: 'database',
      };
    }

    const adapterKey = adapterKeyFromEnv(category, this.configService);
    if (adapterKey === 'mock' && this.configService.get<string>('NODE_ENV') === 'production') {
      this.logger.warn(`No active ${category} provider configured; refusing mock in production`);
      return null;
    }

    return {
      adapter: this.buildAdapter(category, adapterKey),
      config: null,
      source: 'environment',
    };
  }

  decryptSecrets(encrypted: string): Record<string, string> {
    return JSON.parse(this.encryptionService.decrypt(encrypted)) as Record<string, string>;
  }

  private encryptSecrets(secrets: Record<string, string>): string {
    return this.encryptionService.encrypt(JSON.stringify(secrets));
  }

  private buildAdapter(category: ProviderCategory, adapterKey: string): unknown {
    return createAdapterFor(category, adapterKey, this.configService, this.logger);
  }
}
