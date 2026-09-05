import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { UserRole } from '@legal-platform/domain';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Subject } from 'rxjs';
import { OrchestratorService } from './orchestrator.service';
import { HybridInferenceRouter } from './hybrid-inference-router';
import { AgentGovernanceService } from './agent-governance.service';
import { InProcessAgentEventBus } from './agent-event-bus';
import { ExpertRegistry } from './expert-registry';
import { LeaderVoiceService } from './leader-voice.service';
import { GrantAgentDto, RouteQueryDto, VoiceTurnDto } from './dto/route.dto';
import { AuditService } from '../audit/audit.service';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import type { AgentEvent } from '@legal-platform/shared';

interface MessageEvent {
  data: AgentEvent;
}

/**
 * The Leader's console (SPEC §7 dashboard group, §11a).
 * Route/dispatch = ask the tree. Grants = the Leader's control plane over
 * sub-agents. Voice = the manager talks to the Leader directly. Events = the
 * live "kitchen" stream for the dashboard (ADR-006).
 */
@ApiTags('orchestrator')
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller('dashboard/orchestrator')
export class OrchestratorController {
  private readonly eventStream = new Subject<AgentEvent>();

  constructor(
    private readonly orchestrator: OrchestratorService,
    private readonly governance: AgentGovernanceService,
    private readonly inferenceRouter: HybridInferenceRouter,
    private readonly voice: LeaderVoiceService,
    private readonly bus: InProcessAgentEventBus,
    private readonly audit: AuditService,
    private readonly registry: ExpertRegistry,
  ) {
    this.bus.subscribe((event) => this.eventStream.next(event));
  }

  // ---- ask ---------------------------------------------------------------

  @Get('tree')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF, UserRole.OPERATOR)
  @ApiOperation({ summary: 'The Expert Tree: legal fields and their agents' })
  getTree() {
    return { tree: this.orchestrator.getTree(), inference: this.inferenceRouter.describe() };
  }

  @Get('events/recent')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Ring buffer of recent agent events (dashboard initial paint)' })
  recentEvents() {
    return { events: this.bus.recent(100) };
  }

  @Get('fleet')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Society registry: persona cards, skills, grant & health per agent' })
  async fleet() {
    const [cards, grants] = await Promise.all([
      this.registry.describeFleet(),
      this.governance.listGrants(),
    ]);
    const now = new Date();
    return {
      agents: cards.map((c) => ({
        ...c,
        disabled: this.governance.isDisabled(c.agentId),
        activeGrants: grants.filter(
          (g) => g.agentId === c.agentId && !g.revokedAt && new Date(g.expiresAt) > now,
        ).length,
      })),
    };
  }

  @Sse('events/stream')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Live SSE stream — watch the agents cook in real time' })
  streamEvents(): Observable<MessageEvent> {
    return this.eventStream.pipe(map((data) => ({ data })));
  }

  @Post('route')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Classify a query and route it to an expert (dry run)' })
  async route(
    @Body() dto: RouteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const routing = await this.orchestrator.route(dto.query);
    await this.auditSafe(user.id, 'orchestrator.route', routing.agentId, {
      field: routing.classification.field,
      confidence: routing.classification.confidence,
      skillId: routing.skillId,
    });
    return routing;
  }

  @Post('dispatch')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Route + governance check + hybrid inference + execute' })
  async dispatch(
    @Body() dto: RouteQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.orchestrator.dispatch({
      taskId: dto.taskId ?? randomUUID(),
      query: dto.query,
      requestedBy: { userId: user.id, role: user.roles.join(',') },
      sensitivity: dto.sensitivity ?? 'normal',
    });
  }

  // ---- governance: the Leader manages sub-agents -------------------------

  @Get('grants')
  @Roles(UserRole.LAWYER_OWNER, UserRole.OPERATOR)
  @ApiOperation({ summary: 'List capability grants (including expired/revoked)' })
  async listGrants() {
    return { grants: await this.governance.listGrants() };
  }

  @Post('grants')
  @Roles(UserRole.LAWYER_OWNER) // only the office owner unlocks sub-agents
  @ApiOperation({ summary: 'Issue a temporary capability grant to a sub-agent' })
  async grant(@Body() dto: GrantAgentDto, @CurrentUser() user: AuthenticatedUser) {
    const grant = await this.governance.grant({
      agentId: dto.agentId,
      capability: dto.capability,
      grantedBy: user.id,
      expiresAt: new Date(Date.now() + dto.ttlMinutes * 60_000).toISOString(),
    });
    this.bus.emit({
      kind: 'grant.issued',
      at: new Date().toISOString(),
      taskId: 'governance',
      agentId: dto.agentId,
      detail: `${dto.capability} ttl=${dto.ttlMinutes}m by=${user.id}`,
    });
    await this.auditSafe(user.id, 'orchestrator.grant', dto.agentId, {
      capability: dto.capability,
      ttlMinutes: dto.ttlMinutes,
    });
    return { grant };
  }

  @Delete('grants/:grantId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Revoke a grant immediately' })
  async revoke(@Param('grantId') grantId: string, @CurrentUser() user: AuthenticatedUser) {
    await this.governance.revoke(grantId, user.id);
    this.bus.emit({
      kind: 'grant.revoked',
      at: new Date().toISOString(),
      taskId: 'governance',
      agentId: null,
      detail: `grant=${grantId} by=${user.id}`,
    });
    await this.auditSafe(user.id, 'orchestrator.revoke', grantId, {});
    return { revoked: true };
  }

  @Post('agents/:agentId/disable')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Hard off-switch for a sub-agent (manual dashboard control)' })
  async disable(@Param('agentId') agentId: string, @CurrentUser() user: AuthenticatedUser) {
    this.governance.setDisabled(agentId, true);
    await this.auditSafe(user.id, 'orchestrator.agent.disable', agentId, {});
    return { agentId, disabled: true };
  }

  @Post('agents/:agentId/enable')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Re-enable a sub-agent' })
  async enable(@Param('agentId') agentId: string, @CurrentUser() user: AuthenticatedUser) {
    this.governance.setDisabled(agentId, false);
    await this.auditSafe(user.id, 'orchestrator.agent.enable', agentId, {});
    return { agentId, disabled: false };
  }

  // ---- voice: the manager speaks, the Leader answers ---------------------

  @Post('voice/session')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Open a voice session with the Leader' })
  openVoice() {
    return this.voice.openSession();
  }

  @Post('voice/turn')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({
    summary: 'One voice turn: transcribe manager audio, route it, speak back',
  })
  async voiceTurn(@Body() dto: VoiceTurnDto, @CurrentUser() user: AuthenticatedUser) {
    const manager = await this.voice.hear(dto.sessionId, Buffer.alloc(0), dto.transcriptHint);
    const { result, routing, inference } = await this.orchestrator.dispatch({
      taskId: randomUUID(),
      query: manager.text,
      requestedBy: { userId: user.id, role: user.roles.join(',') },
    });
    const spoken = await this.voice.speak(dto.sessionId, result.output);
    return { manager, leader: { text: result.output, ...spoken }, routing, inference };
  }

  // ---- internals ---------------------------------------------------------

  private async auditSafe(
    actorId: string,
    action: string,
    entityId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    // Audit must never break the pipeline (SPEC §2 failure domains) — the
    // service itself logs insert failures; here we only translate the call.
    await this.audit.log({
      actorId,
      module: 'orchestrator',
      action,
      entityType: 'orchestrator',
      entityId: entityId ?? undefined,
      metadata,
      result: 'success',
    });
  }
}
