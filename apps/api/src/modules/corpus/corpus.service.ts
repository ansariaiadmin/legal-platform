import { Inject, Injectable, Logger, Optional, forwardRef } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';
import { InProcessAgentEventBus } from '../orchestrator/agent-event-bus';

/**
 * The shelf (SPEC §5/§9, P2-T2): where law LIVES between the internet and the
 * agents. Every document carries trust_tier (1 official / 2 office-approved /
 * 3 general), a sha256 that makes duplicates impossible, and valid_from/
 * valid_to because "the law changed yesterday" is a fact, not an overwrite.
 *
 * Storage: the StorageProvider port keeps everything ('runtime/corpus/*.json')
 * — the SQL shapes from migration 006 stay the honest source of truth for
 * production; the service code avoids SQL-specific thinking so the swap is
 * storage-only.
 */

export type TrustTier = 1 | 2 | 3;

export interface CorpusSource {
  sourceKey: string;
  displayName: string;
  baseUrl?: string;
  trustTier: TrustTier;
  enabled: boolean;
  qualityScore: number; // health bookkeeping per SPEC §9
}

export interface CorpusDocument {
  documentId: string;
  sourceKey: string;
  canonicalTitle: string;
  bodyRaw: string;
  bodyNormalized: string;
  sha256: string;
  trustTier: TrustTier;
  language: 'fa' | 'en' | 'mixed';
  verifiedAt: string | null;
  verifiedBy: string | null;
  validFrom: string;
  validTo: string | null;
  supersedesId: string | null;
  ingestedAt: string;
  ingestedBy: string;
}

export interface CorpusChunk {
  chunkId: string;
  documentId: string;
  position: number;
  content: string;
}

export interface SearchHit {
  documentId: string;
  canonicalTitle: string;
  trustTier: TrustTier;
  verified: boolean;
  score: number;
  preview: string; // dashboard-safe excerpt (~200 chars)
  /** distinct QUERY terms this doc matched — coverage, the signal a draft
   *  candidate must prove (single-term بپاس can be a false friend) */
  matchedTerms: number;
}

const CHUNK_CHARS = 900;
const CHUNK_OVERLAP = 120;
const SEARCH_LIMIT = 8;
const CJK_STOP_HINT = /[\u0600-\u06FF]/;

@Injectable()
export class CorpusService {
  private readonly logger = new Logger(CorpusService.name);
  private readonly sources = new Map<string, CorpusSource>();
  private readonly docs = new Map<string, CorpusDocument>();
  private readonly chunks = new Map<string, CorpusChunk[]>(); // documentId → chunks
  private searchCache = new Map<string, SearchHit[]>();
  private loaded = false;

  constructor(
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
    @Optional() @Inject(forwardRef(() => InProcessAgentEventBus)) private readonly bus?: InProcessAgentEventBus,
  ) {}

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await this.storage.get('runtime/corpus/store.json');
      const parsed = JSON.parse(raw.toString('utf8')) as {
        sources: CorpusSource[];
        docs: CorpusDocument[];
      };
      this.sources.clear();
      for (const s of parsed.sources) this.sources.set(s.sourceKey, s);
      this.docs.clear();
      for (const d of parsed.docs) this.docs.set(d.documentId, d);
      // chunks are rebuilt per ingest; we lazily re-chunk on miss when searching
    } catch {
      /* first boot — empty shelf is truthful */
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.storage.put({
      key: 'runtime/corpus/store.json',
      content: Buffer.from(
        JSON.stringify({ sources: [...this.sources.values()], docs: [...this.docs.values()] }),
      ),
      contentType: 'application/json',
      metadata: { kind: 'corpus' },
    });
  }

  // ---------- sources -------------------------------------------------------

  async registerSource(input: Omit<CorpusSource, 'qualityScore'> & { qualityScore?: number }): Promise<CorpusSource> {
    await this.ensureLoaded();
    const source: CorpusSource = { qualityScore: 5, ...input };
    this.sources.set(source.sourceKey, source);
    await this.persist();
    this.logger.log(`source registered: ${source.sourceKey} (tier ${source.trustTier})`);
    return source;
  }

  async listSources(): Promise<CorpusSource[]> {
    await this.ensureLoaded();
    return [...this.sources.values()];
  }

  // ---------- ingest --------------------------------------------------------

  async ingestDocument(input: {
    sourceKey: string;
    canonicalTitle: string;
    bodyRaw: string;
    trustTier: TrustTier;
    ingestedBy: string;
    language?: 'fa' | 'en' | 'mixed';
  }): Promise<CorpusDocument> {
    await this.ensureLoaded();
    const sha256 = createHash('sha256').update(input.bodyRaw, 'utf8').digest('hex');
    const duplicate = [...this.docs.values()].find((d) => d.sha256 === sha256);
    if (duplicate) return duplicate; // no double shelving — sha256 honesty

    // Supersession leap: same canonical title, new content → previous version
    // ENDS at the moment the new one begins. History is append-only (SPEC §9).
    const previous = [...this.docs.values()]
      .filter((d) => d.canonicalTitle === input.canonicalTitle && d.validTo === null)
      .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    if (previous) previous.validTo = new Date().toISOString();

    const doc: CorpusDocument = {
      documentId: randomUUID(),
      sourceKey: input.sourceKey,
      canonicalTitle: input.canonicalTitle,
      bodyRaw: input.bodyRaw,
      bodyNormalized: normalizeFa(input.bodyRaw),
      sha256,
      trustTier: input.trustTier,
      language: input.language ?? detectLang(input.bodyRaw),
      verifiedAt: null,
      verifiedBy: null,
      validFrom: new Date().toISOString(),
      validTo: null,
      supersedesId: previous?.documentId ?? null,
      ingestedAt: new Date().toISOString(),
      ingestedBy: input.ingestedBy,
    };
    this.docs.set(doc.documentId, doc);
    this.chunk(doc);
    this.searchCache.clear();

    this.bus?.emit({
      kind: 'corpus.ingested',
      at: new Date().toISOString(),
      taskId: doc.documentId,
      agentId: 'legal-leader',
      detail: `${doc.canonicalTitle} (tier ${doc.trustTier}, ${this.chunks.get(doc.documentId)?.length ?? 0} chunks)`,
    });
    await this.persist();
    this.logger.log(`ingested ${doc.documentId} «${doc.canonicalTitle}» tier=${doc.trustTier}`);
    return doc;
  }

  private chunk(doc: CorpusDocument): void {
    const text = doc.bodyRaw;
    const out: CorpusChunk[] = [];
    // deterministic sliding window; the python sidecar refines boundaries later (pylegal chunk_legal_text)
    let pos = 0;
    let offset = 0;
    while (offset < text.length) {
      const end = Math.min(text.length, offset + CHUNK_CHARS);
      const content = text.slice(offset, end).trim();
      if (content.length > 0) {
        out.push({
          chunkId: randomUUID(),
          documentId: doc.documentId,
          position: pos,
          content,
        });
        pos += 1;
      }
      if (end === text.length) break;
      offset = Math.max(offset + 1, end - CHUNK_OVERLAP);
    }
    this.chunks.set(doc.documentId, out);
  }

  // ---------- verify (validator agent's knob) -------------------------------

  async markVerified(documentId: string, byUserId: string): Promise<CorpusDocument> {
    await this.ensureLoaded();
    const doc = this.needDoc(documentId);
    doc.verifiedAt = new Date().toISOString();
    doc.verifiedBy = byUserId;
    this.searchCache.clear();
    this.bus?.emit({
      kind: 'corpus.validated',
      at: new Date().toISOString(),
      taskId: documentId,
      agentId: 'legal-leader',
      detail: `${doc.canonicalTitle} verified by ${byUserId}`,
    });
    await this.persist();
    return doc;
  }

  // ---------- list + search -------------------------------------------------

  async list(opts?: { trustTier?: TrustTier; verifiedOnly?: boolean }): Promise<CorpusDocument[]> {
    await this.ensureLoaded();
    let out = [...this.docs.values()].filter((d) => d.validTo === null);
    if (opts?.trustTier) out = out.filter((d) => d.trustTier === opts.trustTier);
    if (opts?.verifiedOnly) out = out.filter((d) => d.verifiedAt !== null);
    return out.sort((a, b) => b.ingestedAt.localeCompare(a.ingestedAt));
  }

  /**
   * Deterministic Persian-aware retrieval. No vectors yet (Phase 4c); the
   * score IS: Σ occurrences + phrase boost + tier boost, verified-docs-first.
   * Every term match is traceable — adjacent to a real embedding index later.
   */
  async search(query: string, opts?: { verifiedOnly?: boolean; limit?: number }): Promise<SearchHit[]> {
    await this.ensureLoaded();
    const limit = opts?.limit ?? SEARCH_LIMIT;
    const verifiedOnly = opts?.verifiedOnly ?? true;
    const normalizedQuery = normalizeFa(query.trim());
    if (!normalizedQuery) return [];

    const terms = new Set(
      normalizedQuery
        .split(/\s+/)
        .filter((t) => t.length > 2 && !STOP_WORDS_FA.has(t)),
    );

    const scored: SearchHit[] = [];
    for (const doc of this.docs.values()) {
      if (verifiedOnly && doc.verifiedAt === null) continue;
      if (doc.validTo !== null) continue; // time has already retired it

      const bodyNorm = doc.bodyNormalized;
      let score = 0;
      for (const term of terms) {
        const hits = countOccurrences(bodyNorm, term);
        score += hits;
      }
      if (normalizedQuery.length > 10 && bodyNorm.includes(normalizedQuery)) {
        score += 4; // exact-phrase bonus — lawyer-grade precision
      }
      if (normalizeFa(doc.canonicalTitle).includes(normalizedQuery)) score += 2;
      // Trust shapes ranking, never just volume
      const tierBoost = doc.trustTier === 1 ? 1.6 : doc.trustTier === 2 ? 1.0 : 0.5;
      score *= tierBoost;
      if (score <= 0) continue;
      const matchedTerms = [...terms].filter((t) => bodyNorm.includes(t)).length;

      const previewStart = bodyNorm.indexOf([...terms][0] ?? '') ?? 0;
      scored.push({
        documentId: doc.documentId,
        canonicalTitle: doc.canonicalTitle,
        trustTier: doc.trustTier,
        verified: doc.verifiedAt !== null,
        score: Math.round(score * 100) / 100,
        preview: doc.bodyRaw.slice(Math.max(0, previewStart), Math.max(0, previewStart) + 220),
        matchedTerms,
      });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async statsForDashboard() {
    await this.ensureLoaded();
    const docs = [...this.docs.values()];
    const current = docs.filter((d) => d.validTo === null);
    return {
      sources: this.sources.size,
      documents: current.length,
      verified: current.filter((d) => d.verifiedAt !== null).length,
      retired: docs.length - current.length,
      chunks: [...this.chunks.values()].reduce((s, c) => s + c.length, 0),
      byTier: { official: current.filter((d) => d.trustTier === 1).length, vetted: current.filter((d) => d.trustTier === 2).length, general: current.filter((d) => d.trustTier === 3).length },
    };
  }

  private needDoc(id: string): CorpusDocument {
    const d = this.docs.get(id);
    if (!d) throw new Error(`document not found: ${id}`);
    return d;
  }
}

/* ---------------- normalization & ranking helpers -------------------------

 * Deterministic (SPEC invariant): same input, same search score, every time.
 * ----------------------------------------------------------------------- */

export function normalizeFa(text: string): string {
  return text
    .replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/\u200c/g, ' ')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ۀ/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectLang(text: string): 'fa' | 'en' | 'mixed' {
  const fa = (text.match(/[؀-ۿ]/g) ?? []).length;
  const en = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (fa === 0) return en > 0 ? 'en' : 'fa';
  if (en === 0) return 'fa';
  return 'mixed';
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = haystack.indexOf(needle, i + needle.length);
  }
  return n;
}

// tiny Persian stopbag — search signals stay on law terms, not glue words
const STOP_WORDS_FA = new Set(['از', 'به', 'در', 'که', 'با', 'برای', 'این', 'آن', 'را', 'است', 'و', 'یا', 'اگر', 'تا', 'هست،', 'می‌شود', 'می‌شود‌']);

// kept-as-name hint for later CJK-aware routing (assisted languages)
void CJK_STOP_HINT;
