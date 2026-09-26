import {
  Body, Controller, Get, Optional, Param, Post, Query, Sse, UseGuards,
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
import { PgEmbeddingIndexService, pickSemanticIndex } from './pg-embedding-index.service';
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
    private readonly jsonIndex: EmbeddingIndexService,
    private readonly reranker: RerankerService,
    private readonly drafts: DraftingService,
    private readonly meter: UsageMeterService,
    private readonly bus: InProcessAgentEventBus,
    @Optional() private readonly pgIndex?: PgEmbeddingIndexService,
  ) {}

  /** The live semantic index — the same one drafting reads from. */
  private get index() {
    return pickSemanticIndex(this.jsonIndex, this.pgIndex);
  }

  @Get('index/stats')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Semantic index statistics and health' })
  indexStats() {
    return this.index.stats();
  }

  @Post('index/rebuild')
  @Roles(UserRole.LAWYER_OWNER)
  @ApiOperation({ summary: 'Rebuild the vector index over verified documents (idempotent)' })
  rebuild() {
    return this.index.rebuild();
  }

  @Get('weights')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Current reranker weights' })
  weights() {
    return this.reranker.explainWeights();
  }

  /* ---------------- drafts (citation-bound writing) ----------------------- */

  @Post('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Create a draft; retrieval and generation are separate steps' })
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
  @ApiOperation({ summary: 'Retrieve sources and generate a cited draft for lawyer review' })
  generate(@Param('id') id: string) {
    return this.drafts.generate(id);
  }

  @Get('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'List drafts, newest first' })
  listDrafts() {
    return this.drafts.list();
  }

  @Get('drafts/:id')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'One draft with its sources' })
  getDraft(@Param('id') id: string) {
    return this.drafts.get(id);
  }

  /** P5-T2: live progress for one draft — snapshot first, then bus events.
   *  Completes on terminal state (approved/rejected) or after 120s. */
  @Sse('drafts/:id/stream')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Live progress of one draft (SSE) until it finishes' })
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
        this.drafts.get(id).then(
          (now) => {
            if (now && SSE_DONE.has(now.state)) {
              subscriber.complete();
              unsubscribe();
            }
          },
          (err: unknown) => {
            subscriber.error(err);
            unsubscribe();
          },
        );
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
  @ApiOperation({ summary: 'Review a draft: approve, reject or supersede' })
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
  @ApiOperation({ summary: 'Monthly usage per feature' })
  usage(@Query('month') month?: string) {
    return this.meter.monthlyReport(month);
  }

  @Get('usage/alert')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  @ApiOperation({ summary: 'Alert configuration state' })
  usageAlert() {
    return this.meter.alertState();
  }
}
