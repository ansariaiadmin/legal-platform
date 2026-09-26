import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { UserRole } from '@legal-platform/domain';
import { ConfigHubService, type BrainTarget, type PresetTier } from './config-hub.service';
import { AreaLockGuard, AreaLocked } from '../authvault/area-lock.guard';

class BrainPatchDto {
  @ApiProperty({ enum: ['local', 'cloud'] })
  @IsIn(['local', 'cloud'])
  target!: BrainTarget;

  @ApiPropertyOptional({ example: 'http://192.168.1.20:11434/v1', description: 'Ollama or any OpenAI-compatible endpoint on the office network' })
  @IsString()
  @IsOptional()
  baseUrl?: string;

  @ApiPropertyOptional({ example: 'qwen2.5:14b-instruct' })
  @IsString()
  @IsOptional()
  @MaxLength(120)
  model?: string;

  @ApiPropertyOptional({ description: 'cloud gateways only — stored runtime-only, masked in view' })
  @IsString()
  @IsOptional()
  apiKey?: string;
}

class PresetDto {
  @ApiProperty({ enum: ['spartan', 'counsel', 'senator'] })
  @IsIn(['spartan', 'counsel', 'senator'])
  preset!: PresetTier;
}

class TestConnectionDto extends BrainPatchDto {}

/**
 * The OWNER's connection panel (ADR-014): everything the router needs to
 * serve the fleet gets configured from the dashboard. No developer required —
 * the reply shape is already in Persian, made for humans not parsers.
 */
@ApiTags('config-hub')
@Controller('dashboard/config')
@UseGuards(JwtAccessGuard, RolesGuard, AreaLockGuard)
@AreaLocked('config') // P8-T2: EVERY write/read of brain config sits behind the optional second lock
export class ConfigHubController {
  constructor(private readonly hub: ConfigHubService) {}

  @Get('brain')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Effective AI configuration (environment plus runtime overrides, secrets masked)' })
  brainView() {
    return this.hub.view();
  }

  @Post('brain')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Connect an AI provider by URL or API key (takes effect immediately)' })
  connectBrain(@Body() dto: BrainPatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setBrain(
      { target: dto.target, baseUrl: dto.baseUrl, model: dto.model, apiKey: dto.apiKey },
      user.id,
    );
  }

  @Post('brain/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Test a candidate AI endpoint; succeeds only if it answers' })
  testBrain(@Body() dto: TestConnectionDto) {
    return this.hub.testConnection(dto);
  }

  @Get('profile')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Deployment profile: locale, country, currency, time zone and legal system (Iran by default)' })
  getProfile() {
    return this.hub.getProfile();
  }

  @Post('profile')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Update the deployment profile without redeploying' })
  setProfile(@Body() dto: Partial<import('./config-hub.service').DeploymentProfile>, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setProfile(dto, user.id);
  }

  @Post('preset')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Choose an assistant preset: spartan, counsel or senator' })
  setPreset(@Body() dto: PresetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setPreset(dto.preset, user.id);
  }
}
