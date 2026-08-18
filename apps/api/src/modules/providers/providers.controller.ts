import { Controller, Get, Post, Put, Param, Body, ParseUUIDPipe } from '@nestjs/common';
import { ProvidersService } from './providers.service';
import { AuditService } from '../audit/audit.service';

@Controller('api/dashboard/providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  async findAll() {
    const configs = await this.providersService.findAll();
    // Never return encrypted secrets in API responses
    return configs.map((c) => ({
      ...c,
      encryptedSecrets: undefined,
    }));
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const config = await this.providersService.findOne(id);
    return {
      ...config,
      encryptedSecrets: undefined,
    };
  }

  @Put(':id')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updates: { config?: Record<string, unknown>; encryptedSecrets?: string; isActive?: boolean },
  ) {
    const result = await this.providersService.updateConfig(id, updates);
    await this.auditService.log({
      module: 'providers',
      action: 'config.change',
      entityType: 'provider_config',
      entityId: id,
      metadata: { changes: Object.keys(updates) },
      result: 'success',
    });
    return {
      ...result,
      encryptedSecrets: undefined,
    };
  }

  @Post(':id/test')
  async testConnection(@Param('id', ParseUUIDPipe) id: string) {
    const config = await this.providersService.findOne(id);
    const health = await this.providersService.checkHealth(config);
    
    await this.auditService.log({
      module: 'providers',
      action: 'config.test',
      entityType: 'provider_config',
      entityId: id,
      result: health.valid ? 'success' : 'failure',
    });

    return health;
  }

  @Put(':id/fallback')
  async setFallback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { fallbackId: string | null },
  ) {
    await this.providersService.setFallback(id, body.fallbackId);
    
    await this.auditService.log({
      module: 'providers',
      action: 'fallback.set',
      entityType: 'provider_config',
      entityId: id,
      metadata: { fallbackId: body.fallbackId },
      result: 'success',
    });

    return { success: true };
  }

  @Get('health')
  async healthCheckAll() {
    const configs = await this.providersService.findAll();
    const results: Array<{ id: string; providerType: string; valid: boolean; error?: string }> = [];

    for (const config of configs) {
      const health = await this.providersService.checkHealth(config);
      results.push({
        id: config.id,
        providerType: config.providerType,
        ...health,
      });
    }

    return { results };
  }
}
