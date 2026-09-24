import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { SecurityAuditService } from './security-audit.service';
import { SecuritySchedulerService } from './security-scheduler.service';

/**
 * Security posture APIs (P6-S3). Dashboard-readable for OWNER+STAFF; manual
 * rescans are OWNER-only (scan cadence is an availability surface, SPEC §10).
 */
@ApiTags('security')
@ApiBearerAuth()
@Controller('dashboard/security')
@UseGuards(JwtAccessGuard, RolesGuard)
export class SecurityController {
  constructor(
    private readonly audit: SecurityAuditService,
    private readonly scheduler: SecuritySchedulerService,
  ) {}

  @Get('posture')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'latest posture score (x/10) + counts, or null before first scan' })
  async posture() {
    const latest = await this.audit.latest();
    if (!latest) return { scanned: false };
    return {
      scanned: true,
      postureScore: latest.postureScore,
      at: latest.at,
      passed: latest.passed,
      warned: latest.warned,
      failed: latest.failed,
      applicableChecks: latest.applicableChecks,
      standardsVersion: latest.standardsVersion,
    };
  }

  @Get('standards')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'the standards matrix the guardian enforces (OWASP/ASVS/CWE/NIST refs)' })
  standards() {
    return { standards: this.audit.listStandards() };
  }

  @Get('reports/latest')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'newest full security report incl. per-check evidence + remediation' })
  async latestReport() {
    return { report: await this.audit.latest() };
  }

  @Get('reports')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'report history (bounded ring, persisted across restarts)' })
  async history() {
    return { reports: await this.audit.readHistory() };
  }

  @Post('scan')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'run the standards matrix NOW and persist (guardian agent does this daily too)' })
  async scan() {
    return { report: await this.scheduler.runNow('manual') };
  }

  @Get('schedule')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'scan cadence state: interval + whether the timer is armed' })
  schedule() {
    return this.scheduler.state();
  }
}
