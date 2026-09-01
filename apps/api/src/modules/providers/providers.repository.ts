import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import type { ProviderCategory } from '../../providers/provider.tokens';

export interface ProviderConfigRow {
  id: string;
  provider_type: string;
  adapter_key: string;
  config: Record<string, unknown>;
  encrypted_secrets: string | null;
  is_active: boolean;
  health_status: string;
  last_health_check_at: Date | null;
  fallback_provider_config_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Public shape - the encrypted secret blob never leaves the repository layer. */
export interface ProviderConfigView {
  id: string;
  providerType: ProviderCategory;
  adapterKey: string;
  config: Record<string, unknown>;
  hasSecrets: boolean;
  isActive: boolean;
  healthStatus: string;
  lastHealthCheckAt: Date | null;
  fallbackProviderConfigId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const SELECT_COLUMNS = `id, provider_type, adapter_key, config, encrypted_secrets,
       is_active, health_status, last_health_check_at, fallback_provider_config_id,
       created_at, updated_at`;

@Injectable()
export class ProvidersRepository {
  constructor(private readonly pool: Pool) {}

  toView(row: ProviderConfigRow): ProviderConfigView {
    return {
      id: row.id,
      providerType: row.provider_type as ProviderCategory,
      adapterKey: row.adapter_key,
      config: row.config ?? {},
      hasSecrets: row.encrypted_secrets !== null,
      isActive: row.is_active,
      healthStatus: row.health_status,
      lastHealthCheckAt: row.last_health_check_at,
      fallbackProviderConfigId: row.fallback_provider_config_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async findAll(): Promise<ProviderConfigRow[]> {
    const result = await this.pool.query<ProviderConfigRow>(
      `SELECT ${SELECT_COLUMNS} FROM provider_configs ORDER BY provider_type, adapter_key`,
    );
    return result.rows;
  }

  async findById(id: string): Promise<ProviderConfigRow | null> {
    const result = await this.pool.query<ProviderConfigRow>(
      `SELECT ${SELECT_COLUMNS} FROM provider_configs WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findActiveByType(providerType: ProviderCategory): Promise<ProviderConfigRow | null> {
    const result = await this.pool.query<ProviderConfigRow>(
      `SELECT ${SELECT_COLUMNS}
         FROM provider_configs
        WHERE provider_type = $1 AND is_active = TRUE
        ORDER BY updated_at DESC
        LIMIT 1`,
      [providerType],
    );
    return result.rows[0] ?? null;
  }

  async create(input: {
    providerType: ProviderCategory;
    adapterKey: string;
    config: Record<string, unknown>;
    encryptedSecrets: string | null;
    isActive: boolean;
  }): Promise<ProviderConfigRow> {
    const id = randomUUID();
    const result = await this.pool.query<ProviderConfigRow>(
      `INSERT INTO provider_configs
         (id, provider_type, adapter_key, config, encrypted_secrets, is_active, health_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'unknown')
       RETURNING ${SELECT_COLUMNS}`,
      [
        id,
        input.providerType,
        input.adapterKey,
        JSON.stringify(input.config),
        input.encryptedSecrets,
        input.isActive,
      ],
    );
    return result.rows[0];
  }

  async update(
    id: string,
    patch: Partial<{
      adapterKey: string;
      config: Record<string, unknown>;
      encryptedSecrets: string | null;
      isActive: boolean;
      fallbackProviderConfigId: string | null;
    }>,
  ): Promise<ProviderConfigRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    if (patch.adapterKey !== undefined) {
      sets.push(`adapter_key = $${index++}`);
      values.push(patch.adapterKey);
    }
    if (patch.config !== undefined) {
      sets.push(`config = $${index++}`);
      values.push(JSON.stringify(patch.config));
    }
    if (patch.encryptedSecrets !== undefined) {
      sets.push(`encrypted_secrets = $${index++}`);
      values.push(patch.encryptedSecrets);
    }
    if (patch.isActive !== undefined) {
      sets.push(`is_active = $${index++}`);
      values.push(patch.isActive);
    }
    if (patch.fallbackProviderConfigId !== undefined) {
      sets.push(`fallback_provider_config_id = $${index++}`);
      values.push(patch.fallbackProviderConfigId);
    }

    if (sets.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await this.pool.query<ProviderConfigRow>(
      `UPDATE provider_configs SET ${sets.join(', ')} WHERE id = $${index} RETURNING ${SELECT_COLUMNS}`,
      values,
    );
    return result.rows[0] ?? null;
  }

  async recordHealth(id: string, status: string): Promise<void> {
    await this.pool.query(
      `UPDATE provider_configs SET health_status = $1, last_health_check_at = NOW() WHERE id = $2`,
      [status, id],
    );
  }
}
