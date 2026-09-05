import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { BackupService } from './backup.service';
import { ConfigService } from '@nestjs/config';

/**
 * Honest single/multi-node readout (P8-T5). Right now the event bus and the
 * rate limiter are IN-PROCESS — perfect on a single server (default), and
 * loudly honest about it when the operator claims multi-node.
 */

/**
 * Ops endpoints (P7): portable backup/restore. OWNER-only both ways —
 * restore can overwrite every runtime key, so it is the most privileged
 * write in the dashboard.
 */
@ApiTags('ops')
@ApiBearerAuth()
@Controller('dashboard/ops')
@UseGuards(JwtAccessGuard, RolesGuard)
export class OpsController {
  constructor(
    private readonly backup: BackupService,
    private readonly config: ConfigService,
  ) {}

  @Get('backup')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'export all StorageProvider-backed runtime state as one portable JSON bundle (SQL NOT included — the bundle says so)' })
  download() {
    return this.backup.createBundle();
  }

  @Post('backup/restore')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'restore a bundle; wrong schema rejected, per-key failures are skipped and REPORTED, never silently half-written' })
  restore(@Body() body: unknown) {
    return this.backup.restore(body);
  }

  @Get('deployment')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'deployment mode readout: single (default, batteries included) vs multi (claims honoured ONLY with Redis backing)' })
  deployment() {
    const mode = (this.config.get<string>('DEPLOYMENT_MODE') || 'single') as 'single' | 'multi';
    const redisConfigured = Boolean(this.config.get<string>('REDIS_URL'));
    // honesty invariant (ADR-023): claiming multi WITHOUT the shared queue
    // the design needs is an org misconfig — we surface it, we don't fake it
    const rateDriver = this.config.get<string>('RATE_LIMIT_DRIVER') === 'redis' && redisConfigured ? 'redis' : 'memory';
    const warnings: string[] = [];
    if (mode === 'multi' && !redisConfigured) {
      warnings.push('DEPLOYMENT_MODE=multi but REDIS_URL is unset — in-process bus/limiter are NOT shared between replicas; set Redis before adding a second replica');
    }
    if (mode === 'multi' && rateDriver === 'memory') {
      warnings.push('RATE_LIMIT_DRIVER=redis is the honest multi-node floor — memory limiter is per-replica only');
    }
    return {
      mode,
      capabilities: {
        eventBusBridge: (mode === 'multi' && redisConfigured) ? 'redis-pubsub' : 'in-process',  // P10-T-bus
        rateLimiterDriver: rateDriver,     // redis = shared across replicas (P9-T4)
        sharedStorageDriver: this.config.get<string>('STORAGE_DRIVER') === 'pg' ? 'pg' : 'local-files',
        redisBridgeReady: redisConfigured,
        multiReplicaSafe: mode === 'single' || (redisConfigured && rateDriver === 'redis'),
      },
      warnings,
      note: 'Single-node is the blessed default. Scale-out is ENABLED by REDIS_URL + DEPLOYMENT_MODE=multi — no code change, config only.',
    };
  }

  @Get('backup/scope')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'what the backup does and does NOT cover, in writing' })
  scope() {
    return {
      included: 'StorageProvider runtime keys (drafts, tokens, config, usage, security reports, …)',
      notIncluded: 'SQL database tables — use pg_dump alongside this for a full disaster kit',
    };
  }
}
