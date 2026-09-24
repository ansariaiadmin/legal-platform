import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * P4-T2: the reranker — a PURE FUNCTION with config-driven weights, not a
 * hardcoded belief. Sources of signal can be swapped tomorrow (a learned
 * LLM reranker, a BM25 index) feeding the SAME scores object; the formula
 * stays explainable to a lawyer: lexical + vector + trust + freshness.
 *
 * Weights live in env `RAG_RERANK_WEIGHTS` (JSON) so evolution ships configs,
 * not code. Defaults are conservative: trust-tier dominance, recency soft.
 */

export interface RerankCandidate {
  documentId: string;
  canonicalTitle: string;
  trustTier: 1 | 2 | 3;
  preview: string;
  lexicalScore?: number; // from corpus.search (unnormalized)
  vectorScore?: number; // cosine 0..1
  ingestedAt?: string; // ISO, for the recency term
  /** 'law'|'regulation'|'guideline' — jurisdiction-gram logic later */
  kindHint?: string;
  /** distinct query terms the LEXICAL shelf matched (pass-through for the
   *  drafting coverage gate — never recomputed by magic) */
  matchedTerms?: number;
}

export interface RerankedHit extends RerankCandidate {
  score: number;
  components: { lexical: number; vector: number; tier: number; recency: number };
}

export interface RerankWeights {
  lexical: number;
  vector: number;
  tierBoost: [number, number, number, number]; // [_, t1, t2, t3]
  recencyHalfLifeDays: number;
}

const DEFAULT_WEIGHTS: RerankWeights = {
  lexical: 0.45,
  vector: 0.35,
  tierBoost: [1, 1.6, 1.0, 0.5],
  recencyHalfLifeDays: 365,
};

function maxOr(values: number[], dflt = 1): number {
  let m = 0;
  for (const v of values) if (v > m) m = v;
  return m > 0 ? m : dflt;
}

@Injectable()
export class RerankerService {
  private readonly weights: RerankWeights;

  constructor(private readonly config: ConfigService) {
    const raw = this.config.get<string>('RAG_RERANK_WEIGHTS');
    if (raw) {
      try {
        const o = JSON.parse(raw) as Partial<RerankWeights>;
        this.weights = { ...DEFAULT_WEIGHTS, ...o, tierBoost: o.tierBoost ?? DEFAULT_WEIGHTS.tierBoost };
      } catch {
        this.weights = DEFAULT_WEIGHTS;
      }
    } else {
      this.weights = DEFAULT_WEIGHTS;
    }
  }

  /** Deterministic: same candidates + same weights ⇒ same order, forever. */
  rerank(candidates: RerankCandidate[], opts?: { limit?: number }): RerankedHit[] {
    const w = this.weights;
    const now = Date.now();
    const maxLex = maxOr(candidates.map((c) => c.lexicalScore ?? 0));

    const scored: RerankedHit[] = candidates.map((c) => {
      const lexical = (c.lexicalScore ?? 0) / maxLex;
      const vector = Math.max(0, Math.min(1, c.vectorScore ?? 0));
      const tier = w.tierBoost[c.trustTier] ?? 1;
      let recency = 1;
      if (c.ingestedAt) {
        const days = Math.max(0, (now - Date.parse(c.ingestedAt)) / 86_400_000);
        recency = Math.pow(0.5, days / w.recencyHalfLifeDays);
      }
      const blend = w.lexical * lexical + w.vector * vector;
      const score = blend * tier * recency;
      return {
        ...c,
        score: Math.round(score * 10_000) / 10_000,
        components: { lexical, vector, tier, recency },
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, opts?.limit ?? 8);
  }

  explainWeights(): RerankWeights {
    return this.weights;
  }
}
