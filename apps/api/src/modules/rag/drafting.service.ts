import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DraftRequestState } from '@legal-platform/domain';
import { ERROR_CODES } from '@legal-platform/contracts';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';
import { CorpusService } from '../corpus/corpus.service';
import { EmbeddingIndexService } from './embedding-index.service';
import { RerankerService, type RerankedHit } from './reranker.service';
import { UsageMeterService } from './usage-meter.service';
import { AI_PROVIDER } from '../../providers/provider.tokens';
import type { AIProvider } from '../../providers/ai/ai.provider';
import { PythonWorkerService } from '../orchestrator/python-worker.service';

/**
 * P4-T3: drafting WITH citations — the pipeline where a machine may write
 * but a LAWYER decides. State machine is domain-owned:
 *   created → retrieving → generating → awaiting_review → approved |
 *   rejected → (superseded spawns a fresh `created`)
 * Illegal hops refuse loudly with DRAFT_ILLEGAL_TRANSITION — the UI can
 * never "approve" a draft that never awaited review.
 *
 * CITATIONS ARE THE ENTRY FEE: if the retrieval stage finds no VERIFIED
 * shelf hit above threshold, generation never starts; the draft dies in
 * `created` with an honest DRAFT_NO_CITATIONS. Every token spent goes
 * through UsageMeterService.
 */

export interface DraftCitation {
  documentId: string;
  title: string;
  trustTier: 1 | 2 | 3;
  preview: string;
  score: number;
}

export interface DraftProvenanceBundle {
  query: string;
  retrieved: DraftCitation[];
  model: string | null;
  usage?: { totalTokens?: number } | null;
  seed?: number;
  rerankComponents?: RerankedHit['components'][];
  /** P6-S4: true when no model served and output is verbatim extraction only. */
  degraded?: boolean;
}

export interface DraftRecord {
  draftId: string;
  state: DraftRequestState;
  prompt: string;
  output: string;
  provenance: DraftProvenanceBundle | null;
  createdBy: string;
  createdAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  supersedesId: string | null;
  error: string | null;
}

/* Enforced transitions (SPEC §9): the ONLY lawful moves in the entire
 * system's drafting life. */
const ALLOWED: Record<DraftRequestState, DraftRequestState[]> = {
  [DraftRequestState.CREATED]: [DraftRequestState.RETRIEVING],
  [DraftRequestState.RETRIEVING]: [DraftRequestState.GENERATING, DraftRequestState.CREATED],
  [DraftRequestState.GENERATING]: [DraftRequestState.AWAITING_REVIEW, DraftRequestState.CREATED],
  [DraftRequestState.AWAITING_REVIEW]: [
    DraftRequestState.APPROVED,
    DraftRequestState.REJECTED,
  ],
  [DraftRequestState.APPROVED]: [DraftRequestState.SUPERSEDED],
  [DraftRequestState.REJECTED]: [],
  [DraftRequestState.SUPERSEDED]: [],
};

/* DraftRequestState in packages/domain has NO `failed` member — and SPEC §4
 * forbids forking local enums. So a blocked draft lands BACK in `created`
 * with `error` populated; re-running `generate` after the corpus grows or
 * the AI seam comes up is a perfectly legal move. */

const DRAFTS_KEY = 'runtime/rag/drafts.json';
const REVIEW_MIN_CITATIONS = 1;
/** Entry-fee precision: a draft's TOP hit must cover at least this many
 *  distinct query terms — a lone «قانون» wordmatch can never feather a draft. */
const REVIEW_MIN_TERM_COVERAGE = 2;

/** Needed by the coverage check: corpus.search returns matchedTerms. */

@Injectable()
export class DraftingService {
  private readonly logger = new Logger(DraftingService.name);
  private readonly drafts = new Map<string, DraftRecord>();
  private loaded = false;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    private readonly corpus: CorpusService,
    private readonly index: EmbeddingIndexService,
    private readonly reranker: RerankerService,
    private readonly meter: UsageMeterService,
    @Optional() @Inject(forwardRef(() => InProcessAgentEventBus)) private readonly bus?: InProcessAgentEventBus,
    @Optional() @Inject(AI_PROVIDER) private readonly ai?: AIProvider,
    // P6-S4: python workers are the intelligence floor — when every model
    // (cloud AND local box) is gone, drafts degrade to verbatim extractive
    // spans instead of dying. Never presented as composed advice (SPEC §9).
    @Optional() private readonly workers?: PythonWorkerService,
  ) {}

  private async ensure(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get(DRAFTS_KEY);
      for (const d of JSON.parse(raw.toString('utf8')) as DraftRecord[]) this.drafts.set(d.draftId, d);
    } catch { /* empty draft tray is statable */ }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: DRAFTS_KEY,
      content: Buffer.from(JSON.stringify([...this.drafts.values()])),
      contentType: 'application/json',
      metadata: { kind: 'rag-drafts' },
    });
  }

  private move(draft: DraftRecord, to: DraftRequestState): void {
    const allowed = ALLOWED[draft.state] ?? [];
    if (!allowed.includes(to)) {
      const err = new Error(`draft ${draft.draftId}: illegal move ${draft.state} → ${to}`);
      (err as Error & { code?: string }).code = ERROR_CODES.DRAFT_ILLEGAL_TRANSITION;
      throw err;
    }
    draft.state = to;
  }

  /** create only — retrieval + generation are explicit steps so E2E tests
   *  and the dashboard both see the stages (retrieve → draft WITH cite). */
  async create(input: {
    prompt: string;
    createdBy: string;
    sensitivity?: 'privileged' | 'normal';
    seed?: number;
  }): Promise<DraftRecord> {
    await this.ensure();
    const d: DraftRecord = {
      draftId: randomUUID(),
      state: DraftRequestState.CREATED,
      prompt: input.prompt,
      output: '',
      provenance: null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
      reviewedBy: null,
      reviewedAt: null,
      supersedesId: null,
      error: null,
    };
    this.drafts.set(d.draftId, d);
    this.bus?.emit({ kind: 'draft.created', at: new Date().toISOString(), taskId: d.draftId, agentId: 'legal-leader', detail: input.prompt.slice(0, 60) });
    await this.persist();
    return { ...d };
  }

  /** One-tap pipeline: retrieve → generate when worthy. Returns the draft,
   *  possibly still `created` with error=DRAFT_NO_CITATIONS (citations are
   *  the entry fee, no fake prose without law beneath it). */
  async generate(draftId: string, opts?: { topK?: number }): Promise<DraftRecord> {
    await this.ensure();
    const d = this.need(draftId);
    if (d.state !== DraftRequestState.CREATED) {
      const err = new Error(`draft ${draftId} is ${d.state} — generate needs created`);
      (err as Error & { code?: string }).code = ERROR_CODES.DRAFT_ILLEGAL_TRANSITION;
      throw err;
    }

    this.move(d, DraftRequestState.RETRIEVING);

    // 1) lexical hits from the shelf (verified-only by law)
    const lexical = await this.corpus.search(d.prompt, { verifiedOnly: true, limit: opts?.topK ?? 5 });

    // 2) vector hits on top of the SAME shelf; fuse through the reranker —
    //    a draft's facts may sit at odd phrasing angles to the prompt
    const semantic = await this.index.search(d.prompt, { topK: opts?.topK ?? 5 });
    const candidates = new Map<string, RerankedHit>();
    for (const l of lexical) {
      candidates.set(l.documentId, {
        documentId: l.documentId,
        canonicalTitle: l.canonicalTitle,
        trustTier: l.trustTier,
        preview: l.preview,
        lexicalScore: l.score,
        matchedTerms: l.matchedTerms,
      } as RerankedHit);
    }
    for (const s of semantic) {
      const cur = candidates.get(s.documentId);
      candidates.set(s.documentId, {
        ...(cur ?? {
          documentId: s.documentId,
          canonicalTitle: s.canonicalTitle,
          trustTier: s.trustTier,
          preview: s.preview,
        }),
        vectorScore: s.score,
      } as RerankedHit);
    }
    const ranked = this.reranker.rerank([...candidates.values()], { limit: opts?.topK ?? 5 });
    this.logger.log(`retrieved ${ranked.length} cite-able hits for draft ${draftId}`);

    const topCoversEnough = ((ranked[0] as { matchedTerms?: number } | undefined)?.matchedTerms ?? 0) >= REVIEW_MIN_TERM_COVERAGE;
    if (ranked.length < REVIEW_MIN_CITATIONS || !topCoversEnough) {
      this.move(d, DraftRequestState.CREATED); // back to the tray — rerunnable when corpus grows
      d.error = ERROR_CODES.DRAFT_NO_CITATIONS;
      d.provenance = { query: d.prompt, retrieved: [], model: null, usage: null };
      await this.persist();
      return { ...d };
    }

    const citations: DraftCitation[] = ranked.map((r) => ({
      documentId: r.documentId,
      title: r.canonicalTitle,
      trustTier: r.trustTier,
      preview: r.preview.slice(0, 160),
      score: r.score,
    }));

    // 3) actually generate — behind providers/ai, citation-required tone
    if (!this.ai) {
      const degraded = await this.tryLocalDegradedDraft(d, ranked, citations);
      if (degraded) return degraded;
      this.move(d, DraftRequestState.CREATED);
      d.error = ERROR_CODES.DRAFT_AI_UNAVAILABLE;
      d.provenance = { query: d.prompt, retrieved: citations, model: null, usage: null };
      await this.persist();
      return { ...d };
    }

    this.move(d, DraftRequestState.GENERATING);
    const citeLines = citations.map((c, i) => `[${i + 1}] «${c.title}» (ردهٔ ${c.trustTier}): ${c.preview}`).join('\n');
    const system = [
      'تو یک دستیار حقوقی برای دفتر محترم هستی. پیش‌نویس پاسخ را فقط و فقط بر پایهٔ منبع‌های زیر بنویس.',
      'در پایان پیش‌نویس خط «منابع:» را با شماره‌های مورد استناد بنویس — اگر چیزی فراتر از منبع‌ها لازم شد صادقانه بگو.',
      'اگر منبعی برای نکته‌ای نیامده، آن را به عنوان مطمئن نیاور.',
    ].join('\n');

    try {
      const res = await this.ai.generateText({
        prompt: `درخواست پیش‌نویس: «${d.prompt.slice(0, 800)}»\n\nمنابع معتبر:\n${citeLines}`,
        systemPrompt: system,
        temperature: 0.2,
        maxTokens: 900,
      });
      d.output = res.text;
      await this.meter.recordCall({ feature: 'drafting', model: res.model, usage: res.usage });

      // strip audit-lie: never claim a citation the model didn't actually cite
      const citedNumbers = [...res.text.matchAll(/\[(\d+)]/g)].map((m) => Number(m[1]));
      const citedIdx = citations.filter((_, i) => citedNumbers.includes(i + 1));
      d.provenance = {
        query: d.prompt,
        retrieved: citedIdx.length > 0 ? citedIdx : citations,
        model: res.model,
        usage: res.usage ?? null,
        rerankComponents: ranked.map((r) => r.components),
      };
      this.move(d, DraftRequestState.AWAITING_REVIEW);
    } catch (e) {
      // Provider down mid-call (cloud outage, local box dead): the platform
      // stays intelligent — extractive fallback from the SAME corpus hits.
      const degraded = await this.tryLocalDegradedDraft(d, ranked, citations);
      if (degraded) return degraded;
      this.move(d, DraftRequestState.CREATED);
      d.error = (e as Error).message.slice(0, 200);
    }
    this.bus?.emit({ kind: 'draft.generated', at: new Date().toISOString(), taskId: d.draftId, agentId: 'legal-leader', detail: `${draftId} → ${d.state}` });
    await this.persist();
    return { ...d };
  }

  /**
   * P6-S4 degraded drafting: py worker `local_answer` picks verbatim spans
   * from the JUST-RETRIEVED corpus hits (BM25-lite, stdlib). Markers:
   *  - output header says plainly this is machine-extracted, model absent;
   *  - provenance.model = 'local_rules_extractive';
   *  - state AWAITING_REVIEW still applies — the lawyer gate is NOT bypassed
   *    by degradation (that would be the worst kind of rescue).
   */
  private async tryLocalDegradedDraft(
    d: DraftRecord,
    ranked: RerankedHit[],
    citations: DraftCitation[],
  ): Promise<DraftRecord | null> {
    if (!this.workers) return null;
    try {
      const res = await this.workers.runTool('local_answer', {
        question: d.prompt.slice(0, 800),
        passages: citations.map((c) => `${c.title}: ${c.preview}`),
        top_k: 3,
      }, 8_000);
      const out = res?.output as
        | { answered?: boolean; spans?: Array<{ passageIndex: number; sentence: string; score: number }> }
        | undefined;
      if (!out?.answered || !out.spans || out.spans.length === 0) return null;

      const lines = out.spans
        .map((sp, i) => `${i + 1}. ${sp.sentence} [${sp.passageIndex + 1}] (امتیاز بازیابی: ${sp.score})`)
        .join('\n');
      d.output =
        '⚠️ حالت پایدار بدون مدل: کلاد/مدل محلی در دسترس نبود؛ متن زیر عیناً از منابع بازیابی‌شده استخراج شده و «پاسخ دانش‌آموخته» نیست.\n\n' +
        lines +
        '\n\nمنابع: ' + citations.map((_, i) => `[${i + 1}]`).join(' ');
      d.error = null;
      d.provenance = {
        query: d.prompt,
        retrieved: citations,
        model: 'local_rules_extractive',
        usage: null,
        rerankComponents: ranked.map((r) => r.components),
        degraded: true,
      };
      this.move(d, DraftRequestState.AWAITING_REVIEW);
      this.bus?.emit({
        kind: 'draft.generated',
        at: new Date().toISOString(),
        taskId: d.draftId,
        agentId: 'legal-leader',
        detail: `${d.draftId} → degraded local_rules_extractive (no model)`,
      });
      await this.persist();
      return { ...d };
    } catch {
      return null; // fallback must never break the honest error path
    }
  }

  async get(draftId: string): Promise<DraftRecord | null> {
    await this.ensure();
    const d = this.drafts.get(draftId);
    return d ? { ...d } : null;
  }

  async list(): Promise<DraftRecord[]> {
    await this.ensure();
    return [...this.drafts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** P4-T4 gate: lawyer review. approve|reject on awaiting_review; supersede
   *  on APPROVED spawns a fresh created draft linked back. */
  async review(
    draftId: string,
    action: 'approve' | 'reject' | 'supersede',
    byUserId: string,
  ): Promise<DraftRecord> {
    await this.ensure();
    const d = this.need(draftId);

    if (action === 'supersede') {
      if (d.state !== DraftRequestState.APPROVED) {
        const err = new Error(`supersede needs an approved draft; got ${d.state}`);
        (err as Error & { code?: string }).code = ERROR_CODES.DRAFT_ILLEGAL_TRANSITION;
        throw err;
      }
      this.move(d, DraftRequestState.SUPERSEDED);
      const next = await this.create({ prompt: d.prompt, createdBy: byUserId });
      next.supersedesId = d.draftId;
      this.drafts.set(next.draftId, next);
      this.bus?.emit({ kind: 'draft.reviewed', at: new Date().toISOString(), taskId: d.draftId, agentId: 'legal-leader', detail: `superseded → ${next.draftId}` });
      await this.persist();
      return { ...next };
    }

    const target = action === 'approve' ? DraftRequestState.APPROVED : DraftRequestState.REJECTED;
    this.move(d, target);
    d.reviewedBy = byUserId;
    d.reviewedAt = new Date().toISOString();
    this.bus?.emit({ kind: 'draft.reviewed', at: new Date().toISOString(), taskId: d.draftId, agentId: 'legal-leader', detail: `${action} by ${byUserId}` });
    await this.persist();
    return { ...d };
  }

  private need(id: string): DraftRecord {
    const d = this.drafts.get(id);
    if (!d) {
      const err = new Error(`draft not found: ${id}`);
      (err as Error & { code?: string }).code = ERROR_CODES.DRAFT_NOT_FOUND;
      throw err;
    }
    return d;
  }
}
