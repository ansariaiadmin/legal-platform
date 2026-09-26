import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Sse,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
import { MetricsAggregatorService } from './metrics-aggregator.service';
import { EvaluatorService } from './evaluator.service';
import { EvolutionService } from './evolution.service';
import { ModelAssignmentService } from './model-assignment.service';
import { BudgetGateService } from './budget-gate.service';
import { FileIntelligenceService, type UploadedFilePayload } from './file-intelligence.service';
import { LeaderConversationService } from './leader-conversation.service';
import {
  AssignModelDto,
  GrantAgentDto,
  LeaderChatDto,
  LeaderVoiceChatDto,
  RouteQueryDto,
  SpawnAgentDto,
  VoiceTurnDto,
} from './dto/route.dto';
import { AuditService } from '../audit/audit.service';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import { issueStreamTicket } from '../../security/stream-tickets';
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
    private readonly budgetGate: BudgetGateService,
    private readonly voice: LeaderVoiceService,
    private readonly bus: InProcessAgentEventBus,
    private readonly audit: AuditService,
    private readonly registry: ExpertRegistry,
    private readonly metrics: MetricsAggregatorService,
    private readonly evaluator: EvaluatorService,
    private readonly evolution: EvolutionService,
    private readonly modelAssignments: ModelAssignmentService,
    private readonly files: FileIntelligenceService,
    private readonly conversations: LeaderConversationService,
  ) {
    this.bus.subscribe((event) => this.eventStream.next(event));
  }

  // ---- ask ---------------------------------------------------------------

  @Get('tree')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Legal fields and their expert assistants' })
  getTree() {
    return { tree: this.orchestrator.getTree(), inference: this.inferenceRouter.describe() };
  }

  @Get('events/recent')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Recent assistant events (for the first dashboard render)' })
  recentEvents() {
    return { events: this.bus.recent(100) };
  }

  /**
   * FIELD REVIEW 2026-09-05 #4: browsers can't set Authorization on
   * EventSource, so we mint a SINGLE-USE, 45-second ticket here (via the
   * real bearer path) and the dashboard's SSE proxy passes ?ticket= —
   * a credential in the URL that dies in seconds and replays to nothing.
   */
  @Post('events/stream-ticket')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Issue a single-use 45-second ticket for the event stream' })
  streamTicket(@CurrentUser() user: AuthenticatedUser) {
    const { ticket, expiresInSec } = issueStreamTicket({
      sub: user.id,
      sessionId: user.sessionId,
      roles: user.roles,
    });
    return { ticket, expiresInSec };
  }

  @Get('fleet')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Assistant registry: role, skills, permissions and health of each assistant' })
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

  @Get('insights')
  @Roles(UserRole.LAWYER_OWNER, UserRole.OPERATOR)
  @ApiOperation({
    summary: 'Evaluator report: assistant metrics and ranked improvement suggestions',
  })
  insights() {
    const snapshot = this.metrics.snapshot();
    return { metrics: snapshot, suggestions: this.evaluator.evaluate(snapshot) };
  }

  @Post('spawn')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({
    summary: 'Create a custom assistant (no permissions by default)',
  })
  async spawn(@Body() dto: SpawnAgentDto, @CurrentUser() user: AuthenticatedUser) {
    const result = this.evolution.spawn({ ...dto, spawnedBy: user.id });
    await this.auditSafe(user.id, 'orchestrator.evolution.spawn', result.agentId, {
      field: result.field,
      skills: result.skillIds,
    });
    return result;
  }

  @Delete('spawn/:agentId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Remove a custom assistant (built-in assistants cannot be removed)' })
  async retire(@Param('agentId') agentId: string, @CurrentUser() user: AuthenticatedUser) {
    const removed = this.evolution.retire(agentId, user.id);
    await this.auditSafe(user.id, 'orchestrator.evolution.retire', agentId, { removed });
    return { removed };
  }

  // ---- model matrix: who runs on which brain (ADR-011) -------------------

  @Get('models')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF, UserRole.OPERATOR)
  @ApiOperation({
    summary: 'Model assignment per assistant; unassigned assistants use the lead assistant’s provider',
  })
  async models() {
    const cards = await this.registry.describeFleet();
    return {
      policy: this.inferenceRouter.describe(),
      agents: cards.map((c) => {
        const a = this.modelAssignments.get(c.agentId);
        return {
          agentId: c.agentId,
          persona: c.persona,
          assignment: a ?? null,
          lending: a ? null : { source: 'leader_fallback', meaning: 'رهبر API خودش را قرض می‌دهد' },
        };
      }),
    };
  }

  @Post('models/:agentId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Pin a model (local or cloud) to an agent' })
  async assignModel(
    @Param('agentId') agentId: string,
    @Body() dto: AssignModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!this.registry.get(agentId)) throw new BadRequestException(`unknown agent: ${agentId}`);
    const assignment = this.modelAssignments.assign(agentId, dto.target, dto.model, user.id);
    this.bus.emit({
      kind: 'model.assigned',
      at: new Date().toISOString(),
      taskId: 'models',
      agentId,
      model: dto.model,
      modelTarget: dto.target,
      assignmentSource: 'manual',
      detail: `by=${user.id}`,
    });
    await this.auditSafe(user.id, 'orchestrator.model.assign', agentId, {
      target: dto.target,
      model: dto.model,
    });
    return { assignment };
  }

  @Delete('models/:agentId')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Remove a model assignment; the assistant falls back to the lead assistant’s provider' })
  async unassignModel(@Param('agentId') agentId: string, @CurrentUser() user: AuthenticatedUser) {
    const removed = this.modelAssignments.unassign(agentId);
    if (removed) {
      this.bus.emit({
        kind: 'model.unassigned',
        at: new Date().toISOString(),
        taskId: 'models',
        agentId,
        assignmentSource: 'leader_fallback',
        detail: `reverts to leader lending; by=${user.id}`,
      });
      await this.auditSafe(user.id, 'orchestrator.model.unassign', agentId, {});
    }
    return { removed, fallsBackTo: removed ? 'leader_fallback' : null };
  }

  @Sse('events/stream')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Live event stream (SSE) of assistant activity' })
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
  @ApiOperation({ summary: 'Route a request, check permissions and execute it' })
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
  @ApiOperation({ summary: 'Disable an assistant' })
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

  // ---- the Leader conversation surface (ADR-013) --------------------------

  /** P3-T4 visibility: per-feature spend vs quota for the dashboard. */
  @Get('budget')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  budget(@CurrentUser() user: AuthenticatedUser, @Param() _params?: unknown) {
    void user;
    void _params;
    return this.budgetGate.all(['tiebreak']);
  }

  /** P3-T1..T5 dry-run: route a query, see the full candidate trace —
   *  deterministic path AND llm fallback (when it fired) included. */
  @Post('dry-run')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  async dryRun(@Body() body: { query: string }) {
    const routing = await this.orchestrator.route(body.query, `dry-${Date.now()}`);
    return {
      routing,
      trace: routing.trace ?? [],
      wouldLlmFallback: routing.needsLlmTiebreak,
    };
  }

  @Get('files')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'List my uploaded files (id, name, length, OCR needed)' })
  listFiles(@CurrentUser() user: AuthenticatedUser) {
    return { files: this.files.listByUser(user.id) };
  }

  @Post('files')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Upload a file for the lead assistant; it is registered and analysed' })
  async uploadFile(
    @UploadedFile() file: UploadedFilePayload | undefined,
    @Body('sensitivity') sensitivity: 'privileged' | 'normal' | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException('file field is required');
    const record = await this.files.register(file, user.id, sensitivity);
    // The Leader READS before anyone talks about the file (product law).
    const analyzed = await this.files.analyze(record.fileId);
    await this.auditSafe(user.id, 'orchestrator.file.upload', record.fileId, {
      filename: record.filename,
      size: record.size,
      sha256: record.sha256.slice(0, 16),
      sensitivity: sensitivity ?? 'normal',
    });
    return { file: analyzed };
  }

  @Post('leader/conversations')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Open a chat session with the lead assistant' })
  openConversation(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.open(user.id);
  }

  @Get('leader/conversations')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'List my conversations' })
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return { conversations: this.conversations.listByOwner(user.id) };
  }

  @Post('leader/chat')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Chat with the lead assistant using text and attached files' })
  async leaderChat(@Body() dto: LeaderChatDto, @CurrentUser() user: AuthenticatedUser) {
    const convId = dto.conversationId ?? this.conversations.open(user.id).conversationId;
    const reply = await this.conversations.chat(
      {
        conversationId: convId,
        text: dto.text,
        fileIds: dto.fileIds,
        sensitivity: dto.sensitivity,
      },
      { id: user.id, role: user.roles.join(',') },
    );
    await this.auditSafe(user.id, 'orchestrator.leader.chat', convId, {
      files: dto.fileIds?.length ?? 0,
      routedTo: reply.routing.agentId,
    });
    return { conversationId: convId, ...reply };
  }

  @Post('leader/voice-chat')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Voice turn: transcribe, answer and reply with speech' })
  async leaderVoiceChat(@Body() dto: LeaderVoiceChatDto, @CurrentUser() user: AuthenticatedUser) {
    const reply = await this.conversations.voiceChat(
      {
        sessionId: dto.sessionId,
        conversationId: dto.conversationId,
        transcriptHint: dto.transcriptHint,
        fileIds: dto.fileIds,
      },
      { id: user.id, role: user.roles.join(',') },
    );
    await this.auditSafe(user.id, 'orchestrator.leader.voice', dto.conversationId, {});
    return reply;
  }

  @Post('leader/config-proposals/:proposalId/accept')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Approve a configuration change proposed by the lead assistant' })
  async acceptConfig(@Param('proposalId') proposalId: string, @CurrentUser() user: AuthenticatedUser) {
    const applied = await this.conversations.acceptProposal(proposalId, user.id);
    await this.auditSafe(user.id, 'orchestrator.leader.config', proposalId, applied);
    return applied;
  }

  // ---- voice: the manager speaks, the Leader answers ---------------------

  @Post('voice/session')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Open a voice session with the lead assistant' })
  openVoice() {
    return this.voice.openSession();
  }

  @Post('voice/turn')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({
    summary: 'One voice turn: transcribe, route and reply with speech',
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
