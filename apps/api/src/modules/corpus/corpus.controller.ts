import {
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
@ApiTags('corpus')
@ApiBearerAuth()
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
  @ApiOperation({ summary: 'Library statistics for the dashboard' })
  async stats() {
    return this.corpus.statsForDashboard();
  }

  
  @Get('sources')
  @ApiOperation({ summary: 'List registered knowledge sources' })
  async sources() {
    return this.corpus.listSources();
  }

  
  @Post('sources')
  @ApiOperation({ summary: 'Register a source with its trust tier' })
  async registerSource(
    @Body() body: { sourceKey: string; displayName: string; trustTier: 1 | 2 | 3; baseUrl?: string },
  ) {
    return this.corpus.registerSource({ ...body, enabled: true });
  }

  
  @Get('documents')
  @ApiOperation({ summary: 'List library documents (verified first)' })
  async documents(@Query('tier') tier?: string, @Query('verifiedOnly') verifiedOnly?: string) {
    return this.corpus.list({
      trustTier: tier ? (Number(tier) as 1 | 2 | 3) : undefined,
      verifiedOnly: verifiedOnly === 'true',
    });
  }

  
  @Get('documents/:id')
  @ApiOperation({ summary: 'Fetch one document' })
  async document(@Param('id') id: string) {
    const doc = (await this.corpus.list()).find((d) => d.documentId === id);
    if (!doc) return { found: false };
    return { found: true, document: doc };
  }

  /** Paste a raw law text — lands pending validation, never pre-verified. */
  
  @Post('documents/ingest')
  @ApiOperation({ summary: 'Submit raw legal text for validation' })
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
  @ApiOperation({ summary: 'Ingest an uploaded office file in full (flags pages that need OCR)' })
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
  @ApiOperation({ summary: 'Verify a document (validator must pass; rejection reasons are returned)' })
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
  @ApiOperation({ summary: 'Supersede a document with new text (history is kept)' })
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
  @ApiOperation({ summary: 'Search the legal library (verified documents first)' })
  async search(@Query('q') q: string, @Query('all') all?: string) {
    return this.corpus.search(q ?? '', { verifiedOnly: all !== 'true' });
  }

  /* ---- collection & diagnostics (P2-T2/T5/T6) ---------------------------- */

  /** List collector sources with mock adapters (wire-ready contract). */
  
  @Get('jobs')
  @ApiOperation({ summary: 'All ingestion jobs, newest first' })
  async jobs() {
    return this.worker.list();
  }

  /** SPEC §9 diagnostics: the stuff a human should look at — failed,
   *  partial, or validator-rejected runs, newest first. */
  
  @Get('diagnostics')
  @ApiOperation({ summary: 'Failed, partial and rejected collection runs, with their sources' })
  async diagnostics() {
    return {
      failures: await this.worker.failures(),
      collectorSources: this.collector.listSources(),
    };
  }

  /** Sync one source window now. Idempotent per (source, window): asking
   *  again for the same day replays as a no-op. Production has no sample
   *  source, so without a registered collector this answers 409. */
  @Post('sync')
  @ApiOperation({ summary: 'Sync one source window now (idempotent; 409 when no collector source is registered)' })
  async sync(@Body() body: { sourceId?: string; date?: string }) {
    const sources = this.collector.listSources();
    const sourceId = body.sourceId ?? sources[0];
    if (!sourceId || !sources.includes(sourceId)) {
      throw new ConflictException({
        code: 'SYSTEM_FEATURE_NOT_AVAILABLE',
        message: 'هنوز هیچ منبع خودکاری برای گردآوری قوانین متصل نشده است. متن قانون را دستی یا از فایل اضافه کنید.',
      });
    }
    return this.worker.sync(sourceId, body.date);
  }

  /** Manual retry for a seen failure — linked to the old run, counted fresh. */
  
  @Post('jobs/:id/retry')
  @ApiOperation({ summary: 'Retry manually, linked to the previous attempt' })
  async retry(@Param('id') id: string) {
    const job = await this.worker.retry(id);
    if (!job) return { retried: false, reason: 'کار یافت نشد' };
    return { retried: true, job };
  }
}
