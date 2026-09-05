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

class BrainPatchDto {
  @ApiProperty({ enum: ['local', 'cloud'] })
  @IsIn(['local', 'cloud'])
  target!: BrainTarget;

  @ApiPropertyOptional({ example: 'http://gpu-box:8080' })
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
@UseGuards(JwtAccessGuard, RolesGuard)
export class ConfigHubController {
  constructor(private readonly hub: ConfigHubService) {}

  @Get('brain')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Effective brain: env ∩ runtime overrides, secrets masked' })
  brainView() {
    return this.hub.view();
  }

  @Post('brain')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Connect a brain: paste URL or API key — effective immediately' })
  connectBrain(@Body() dto: BrainPatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setBrain(
      { target: dto.target, baseUrl: dto.baseUrl, model: dto.model, apiKey: dto.apiKey },
      user.id,
    );
  }

  @Post('brain/test')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Probe the candidate endpoint honestly — green only if it answers' })
  testBrain(@Body() dto: TestConnectionDto) {
    return this.hub.testConnection(dto);
  }

  @Get('profile')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'P7 deployment profile: locale/country/currency/timezone/legalSystem (Iran defaults)' })
  getProfile() {
    return this.hub.getProfile();
  }

  @Post('profile')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'P7 re-skin the deployment for any country — one patch, no redeploy' })
  setProfile(@Body() dto: Partial<import('./config-hub.service').DeploymentProfile>, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setProfile(dto, user.id);
  }

  @Post('preset')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Pick a fleet preset: spartan / counsel / senator' })
  setPreset(@Body() dto: PresetDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hub.setPreset(dto.preset, user.id);
  }
}
