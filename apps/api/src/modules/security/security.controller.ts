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
  @ApiOperation({ summary: 'Latest security score (out of 10) and counts; null before the first scan' })
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
  @ApiOperation({ summary: 'Security checks and their OWASP, ASVS, CWE and NIST references' })
  standards() {
    return { standards: this.audit.listStandards() };
  }

  @Get('reports/latest')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Latest full security report, with evidence and remediation per check' })
  async latestReport() {
    return { report: await this.audit.latest() };
  }

  @Get('reports')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Report history (most recent reports, kept across restarts)' })
  async history() {
    return { reports: await this.audit.readHistory() };
  }

  @Post('scan')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Run the security checks now (they also run daily)' })
  async scan() {
    return { report: await this.scheduler.runNow('manual') };
  }

  @Get('schedule')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Scan schedule: interval and whether it is active' })
  schedule() {
    return this.scheduler.state();
  }
}
