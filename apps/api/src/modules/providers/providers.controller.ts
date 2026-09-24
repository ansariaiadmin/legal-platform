import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { ProvidersService } from './providers.service';
import { AuditService } from '../audit/audit.service';
import { CreateProviderConfigDto, SetFallbackDto, UpdateProviderConfigDto } from './dto/provider-config.dto';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';

/**
 * Provider settings (SPEC section 7: dashboard group; section 8: providers).
 *
 * Route order matters - `health` must be declared before `:id`, otherwise
 * `/providers/health` is captured by the `:id` route and rejected by
 * ParseUUIDPipe.
 */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.LAWYER_OWNER, UserRole.OPERATOR)
@Controller('dashboard/providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List provider configurations (secrets omitted)' })
  async findAll() {
    return this.providersService.list();
  }

  @Get('health')
  @ApiOperation({ summary: 'Run a health check against every configured provider' })
  async healthCheckAll() {
    return { results: await this.providersService.healthSummary() };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one provider configuration' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.providersService.get(id);
  }

  @Post()
  @ApiOperation({ summary: 'Register a provider configuration' })
  async create(@Body() dto: CreateProviderConfigDto, @CurrentUser() user: AuthenticatedUser) {
    const created = await this.providersService.create(dto);

    await this.auditService.log({
      actorId: user.id,
      module: 'providers',
      action: 'config.create',
      entityType: 'provider_config',
      entityId: created.id,
      metadata: { providerType: created.providerType, adapterKey: created.adapterKey },
      result: 'success',
    });

    return created;
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a provider configuration' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProviderConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.providersService.update(id, dto);

    await this.auditService.log({
      actorId: user.id,
      module: 'providers',
      action: 'config.change',
      entityType: 'provider_config',
      entityId: id,
      // Never log the secret values themselves.
      metadata: { changedFields: Object.keys(dto) },
      result: 'success',
    });

    return updated;
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Test the connection before trusting a configuration' })
  async testConnection(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const health = await this.providersService.testConnection(id);

    await this.auditService.log({
      actorId: user.id,
      module: 'providers',
      action: 'config.test',
      entityType: 'provider_config',
      entityId: id,
      result: health.valid ? 'success' : 'failure',
    });

    return health;
  }

  @Put(':id/fallback')
  @ApiOperation({ summary: 'Set or clear the fallback provider for a category' })
  async setFallback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetFallbackDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const updated = await this.providersService.setFallback(id, dto.fallbackId);

    await this.auditService.log({
      actorId: user.id,
      module: 'providers',
      action: 'fallback.set',
      entityType: 'provider_config',
      entityId: id,
      metadata: { fallbackId: dto.fallbackId },
      result: 'success',
    });

    return updated;
  }
}
