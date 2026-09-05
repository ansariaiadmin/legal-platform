import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { BackupService } from './backup.service';

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
  constructor(private readonly backup: BackupService) {}

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
