import {
  Body, Controller, Get, Param, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAccessGuard } from '../../security/jwt-access.guard';
import { RolesGuard } from '../../security/roles.guard';
import { CurrentUser } from '../../security/current-user.decorator';
import type { AuthenticatedUser } from '../../security/authenticated-user';
import { CorpusService, DataValidatorService, LawUpdaterService } from './index';
import { IngestionWorkerService } from './ingestion-worker.service';
import { CollectorAgentService } from './collector-agent.service';
import { FileIntelligenceService } from '../orchestrator/file-intelligence.service';
import { createHash } from 'node:crypto';

/**
 * The shelf's counter (dashboard side). All mutations are lawyer-side only —
 * this corpus contains the office's knowledge base, never public read.
 */
@Controller('dashboard/corpus')
@UseGuards(JwtAccessGuard, RolesGuard)
export class CorpusController {
  constructor(
    private readonly corpus: CorpusService,
    private readonly validator: DataValidatorService,
    private readonly updater: LawUpdaterService,
    private readonly worker: IngestionWorkerService,
    private readonly collector: CollectorAgentService,
    private readonly files: FileIntelligenceService,
  ) {}

  @Get('stats')
  async stats() {
    return this.corpus.statsForDashboard();
  }

  @Get('sources')
  async sources() {
    return this.corpus.listSources();
  }

  @Post('sources')
  async registerSource(
    @Body() body: { sourceKey: string; displayName: string; trustTier: 1 | 2 | 3; baseUrl?: string },
  ) {
    return this.corpus.registerSource({ ...body, enabled: true });
  }

  @Get('documents')
  async documents(@Query('tier') tier?: string, @Query('verifiedOnly') verifiedOnly?: string) {
    return this.corpus.list({
      trustTier: tier ? (Number(tier) as 1 | 2 | 3) : undefined,
      verifiedOnly: verifiedOnly === 'true',
    });
  }

  @Get('documents/:id')
  async document(@Param('id') id: string) {
    const doc = (await this.corpus.list()).find((d) => d.documentId === id);
    if (!doc) return { found: false };
    return { found: true, document: doc };
  }

  /** Paste a raw law text — lands pending validation, never pre-verified. */
  @Post('documents/ingest')
  async ingest(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: { canonicalTitle: string; bodyRaw: string; sourceKey?: string; trustTier?: 1 | 2 | 3 },
  ) {
    const doc = await this.corpus.ingestDocument({
      sourceKey: body.sourceKey ?? 'dashboard-manual',
      canonicalTitle: body.canonicalTitle,
      bodyRaw: body.bodyRaw,
      trustTier: body.trustTier ?? 3,
      ingestedBy: user?.id ?? 'lawyer',
    });
    return { ingested: true, documentId: doc.documentId, sha256: doc.sha256 };
  }

  /**
   * Ingest straight from an already-uploaded office file — file-intelligence
   * extracts the FULL text honestly (needs flags surfaced, never invented),
   * the corpus shelves it as tier 2 pending validation.
   */
  @Post('documents/ingest-from-file')
  async ingestFromFile(@Body() body: { fileId: string; canonicalTitle?: string; trustTier?: 1 | 2 | 3 }) {
    const found = this.files.probe(body.fileId);
    if (!found) return { ingested: false, reason: 'فایل یافت نشد' };
    const shelf = await this.files.shelfText(body.fileId);
    if (!shelf.text || shelf.text.trim().length < 50) {
      return { ingested: false, reason: shelf.reason };
    }
    const doc = await this.corpus.ingestDocument({
      sourceKey: 'office-upload',
      canonicalTitle: body.canonicalTitle ?? shelf.filename,
      bodyRaw: shelf.text,
      trustTier: body.trustTier ?? 2,
      ingestedBy: found.uploadedBy,
    });
    return { ingested: true, documentId: doc.documentId, sha256: doc.sha256 };
  }

  /**
   * The green tick. Runs the validator's deterministic rules first; the row
   * is stamped verified ONLY when every rule passes, and the caller gets the
   * reasons back when it does not. No force-verify endpoint exists (§9).
   */
  @Post('documents/:id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    const doc = (await this.corpus.list()).find((d) => d.documentId === id);
    if (!doc) return { verified: false, reasons: ['سند یافت نشد'] };

    const outcome = await this.validator.validate({
      sourceUrl: doc.sourceKey,
      fetchedAt: doc.ingestedAt,
      contentSha256: createHash('sha256').update(doc.bodyRaw, 'utf8').digest('hex'),
      rawText: doc.bodyRaw,
      trustTier: doc.trustTier,
    });
    if (!outcome.verified) return { verified: false, reasons: outcome.reasons };

    const stamped = await this.corpus.markVerified(id, user?.id ?? 'validator');
    return { verified: true, verifiedAt: stamped.verifiedAt, reasons: [] };
  }

  /** Temporal update: text arrives for a title already shelved. */
  @Post('documents/update')
  async update(@Body() body: { canonicalTitle: string; bodyRaw: string; sourceKey?: string }) {
    return this.updater.applyUpdate({
      canonicalTitle: body.canonicalTitle,
      bodyRaw: body.bodyRaw,
      sourceKey: body.sourceKey ?? 'dashboard-manual',
      trustTier: 2,
      ingestedBy: 'lawyer',
    });
  }

  @Get('search')
  async search(@Query('q') q: string, @Query('all') all?: string) {
    return this.corpus.search(q ?? '', { verifiedOnly: all !== 'true' });
  }

  /* ---- collection & diagnostics (P2-T2/T5/T6) ---------------------------- */

  /** List collector sources with mock adapters (wire-ready contract). */
  @Get('jobs')
  async jobs() {
    return this.worker.list();
  }

  /** SPEC §9 diagnostics: the stuff a human should look at — failed,
   *  partial, or validator-rejected runs, newest first. */
  @Get('diagnostics')
  async diagnostics() {
    return {
      failures: await this.worker.failures(),
      collectorSources: this.collector.listSources(),
    };
  }

  /** Kick a sync NOW for a source (mock adapter in dev). Idempotent per
   *  (source, window): re-asking the same day replays as a no-op. */
  @Post('sync')
  async sync(@Body() body: { sourceId?: string; date?: string }) {
    return this.worker.sync(body.sourceId ?? 'rooznameh-mock', body.date);
  }

  /** Manual retry for a seen failure — linked to the old run, counted fresh. */
  @Post('jobs/:id/retry')
  async retry(@Param('id') id: string) {
    const job = await this.worker.retry(id);
    if (!job) return { retried: false, reason: 'کار یافت نشد' };
    return { retried: true, job };
  }
}
