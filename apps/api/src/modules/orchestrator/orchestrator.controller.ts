import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { randomUUID } from 'node:crypto';
import { OrchestratorService } from './orchestrator.service';
import { RouteQueryDto } from './dto/route.dto';
import { AuditService } from '../audit/audit.service';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';

/**
 * Orchestrator endpoints (SPEC §7 dashboard group, §11a).
 * Platform-agnostic by design: the web app, a Telegram bot or a mobile client
 * all hit the same REST surface (ADR-000).
 */
@ApiTags('orchestrator')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
@Controller('dashboard/orchestrator')
export class OrchestratorController {
  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly audit: AuditService,
  ) {}

  @Get('tree')
  @ApiOperation({ summary: 'The Expert Tree: legal fields and their agents' })
  getTree() {
    return { tree: this.orchestrator.getTree() };
  }

  @Post('route')
  @ApiOperation({ summary: 'Classify a query and route it to an expert (dry run)' })
  async route(
    @Body() dto: RouteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const routing = await this.orchestrator.route(dto.query);
    await this.audit.log({
      actorId: user.id,
      module: 'orchestrator',
      action: 'orchestrator.route',
      entityType: 'orchestrator_route',
      metadata: {
        agentId: routing.agentId,
        skillId: routing.skillId,
        field: routing.classification.field,
        confidence: routing.classification.confidence,
      },
      result: routing.agentId ? 'success' : 'failure',
    });
    return routing;
  }

  @Post('dispatch')
  @ApiOperation({ summary: 'Route a query and execute the winning expert' })
  async dispatch(
    @Body() dto: RouteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orchestrator.dispatch({
      taskId: dto.taskId ?? randomUUID(),
      query: dto.query,
      requestedBy: { userId: user.id, role: user.roles.join(',') },
    });
  }
}
