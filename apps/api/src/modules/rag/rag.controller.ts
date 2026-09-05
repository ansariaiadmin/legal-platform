import {
  Body, Controller, Get, Param, Post, Query, Sse, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type { AgentEvent } from '@legal-platform/shared';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { EmbeddingIndexService } from './embedding-index.service';
import { RerankerService } from './reranker.service';
import { DraftingService } from './drafting.service';
import { UsageMeterService } from './usage-meter.service';

/** Terminal states where the draft SSE completes by itself — no orphan stream. */
const SSE_DONE = new Set(['approved', 'rejected']);

/**
 * P4 console: semantic index, citation-bound drafts, lawyer review,
 * usage metering — plus P5-T2 live SSE progress per draft.
 * Restricted to LAWYER_OWNER / STAFF eyes.
 */
@ApiTags('rag')
@ApiBearerAuth()
@Controller('dashboard/rag')
@UseGuards(JwtAccessGuard, RolesGuard)
export class RagController {
  constructor(
    private readonly index: EmbeddingIndexService,
    private readonly reranker: RerankerService,
    private readonly drafts: DraftingService,
    private readonly meter: UsageMeterService,
    private readonly bus: InProcessAgentEventBus,
  ) {}

  @Get('index/stats')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'stats + degradation flag for the semantic index' })
  indexStats() {
    return this.index.stats();
  }

  @Post('index/rebuild')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'rebuild the vector index over the verified shelf (idempotent)' })
  rebuild() {
    return this.index.rebuild();
  }

  @Get('weights')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'show the exact reranker weights — no magic numbers' })
  weights() {
    return this.reranker.explainWeights();
  }

  /* ---------------- drafts (citation-bound writing) ----------------------- */

  @Post('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'create a draft stub — retrieval/generate are separate steps' })
  async createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { prompt: string; sensitivity?: 'privileged' | 'normal' },
  ) {
    return this.drafts.create({
      prompt: body.prompt,
      createdBy: user.id,
      sensitivity: body.sensitivity,
    });
  }

  @Post('drafts/:id/generate')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'retrieve → cite-behood generate → awaiting lawyereview' })
  generate(@Param('id') id: string) {
    return this.drafts.generate(id);
  }

  @Get('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'list drafts newest-first' })
  listDrafts() {
    return this.drafts.list();
  }

  @Get('drafts/:id')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'one draft with its provenance bundle' })
  getDraft(@Param('id') id: string) {
    return this.drafts.get(id);
  }

  /** P5-T2: live progress for one draft — snapshot first, then bus events.
   *  Completes on terminal state (approved/rejected) or after 120s. */
  @Sse('drafts/:id/stream')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'SSE: live progress for one draft until a terminal state' })
  streamDraft(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    return this.drafts.get(id).then((snapshot) => new Observable<MessageEvent>((subscriber) => {
      subscriber.next({
        data: { stage: 'snapshot', draft: snapshot, at: new Date().toISOString() },
      } as MessageEvent);
      if (snapshot && SSE_DONE.has(snapshot.state)) {
        subscriber.complete();
        return undefined;
      }
      const started = Date.now();
      const unsubscribe = this.bus.subscribe((ev: AgentEvent) => {
        if (ev.taskId !== id) return;
        subscriber.next({ data: ev } as MessageEvent);
        void this.drafts.get(id).then((now) => {
          if (now && SSE_DONE.has(now.state)) {
            subscriber.complete();
            unsubscribe();
          }
        });
        if (Date.now() - started > 120_000) {
          subscriber.complete();
          unsubscribe();
        }
      });
      return () => {
        unsubscribe();
      };
    }));
  }

  @Post('drafts/:id/review')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'P4-T4 review gate: approve | reject | supersede' })
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject' | 'supersede' },
  ) {
    return this.drafts.review(id, body.action, user.id);
  }

  /* ---------------- usage metering (P4-T5) -------------------------------- */

  @Get('usage/monthly')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'per-feature rollups for the month — never invented' })
  usage(@Query('month') month?: string) {
    return this.meter.monthlyReport(month);
  }

  @Get('usage/alert')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'alert arming state — readable, nothing resets silently' })
  usageAlert() {
    return this.meter.alertState();
  }
}
