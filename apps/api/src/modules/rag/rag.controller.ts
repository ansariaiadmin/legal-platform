import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@legal-platform/domain';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { Roles, RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { EmbeddingIndexService } from './embedding-index.service';
import { RerankerService } from './reranker.service';
import { DraftingService } from './drafting.service';
import { UsageMeterService } from './usage-meter.service';

/**
 * P4 console: semantic index, citation-bound drafts, lawyer review,
 * usage metering — all for `LAWYER_OWNER` / `STAFF` eyes only.
 */
@Controller('dashboard/rag')
@UseGuards(JwtAccessGuard, RolesGuard)
export class RagController {
  constructor(
    private readonly index: EmbeddingIndexService,
    private readonly reranker: RerankerService,
    private readonly drafts: DraftingService,
    private readonly meter: UsageMeterService,
  ) {}

  /** index stats + provider health — a dashboard telling the truth even in dev */
  @Get('index/stats')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  indexStats() {
    return this.index.stats();
  }

  /** rebuild over the shelf's verified set; returns exactly what happened */
  @Post('index/rebuild')
  @Roles(UserRole.LAWYER_OWNER)
  rebuild() {
    return this.index.rebuild();
  }

  /** the weight table so the UI never shows magic scores */
  @Get('weights')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  weights() {
    return this.reranker.explainWeights();
  }

  /* ---------------- drafts (citation-bound writing) ----------------------- */

  @Post('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  async createDraft(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { prompt: string; sensitivity?: 'privileged' | 'normal' },
  ) {
    const draft = await this.drafts.create({
      prompt: body.prompt,
      createdBy: user.id,
      sensitivity: body.sensitivity,
    });
    return draft;
  }

  /** run the pipeline: retrieve → generate → await lawyer review */
  @Post('drafts/:id/generate')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  generate(@Param('id') id: string) {
    return this.drafts.generate(id);
  }

  @Get('drafts')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  listDrafts() {
    return this.drafts.list();
  }

  @Get('drafts/:id')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  getDraft(@Param('id') id: string) {
    return this.drafts.get(id);
  }

  /** P4-T4 review gate — outcome lands in the audit trail via the filter. */
  @Post('drafts/:id/review')
  @Roles(UserRole.LAWYER_OWNER)
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { action: 'approve' | 'reject' | 'supersede' },
  ) {
    return this.drafts.review(id, body.action, user.id);
  }

  /* ---------------- usage metering (P4-T5) -------------------------------- */

  @Get('usage/monthly')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  usage(@Query('month') month?: string) {
    return this.meter.monthlyReport(month);
  }

  /** alert arming state — readable; nothing resets silently */
  @Get('usage/alert')
  @Roles(UserRole.LAWYER_OWNER, UserRole.STAFF)
  usageAlert() {
    return this.meter.alertState();
  }
}
