import { Injectable } from '@nestjs/common';
import type { AgentMetrics } from './metrics-aggregator.service';

export type SuggestionKind =
  | 'split_vocabulary'       // route score OK but mixed domains — split skill
  | 'raise_min_score'        // too many misses slipping through
  | 'lower_min_score'        // healthy agent starved by threshold
  | 'spawn_role'             // missing capability — create a new member
  | 'tune_hybrid_policy'     // infra placement inefficiency
  | 'review_grants';         // denials pile-up

export interface EvolutionSuggestion {
  id: string;
  agentId: string | null; // null = fleet-level suggestion
  kind: SuggestionKind;
  /** Persian, board-memo tone — the evaluator speaks to the owner. */
  summaryFa: string;
  evidence: Record<string, unknown>;
  /** 0..1 certainty of the evaluator in THIS suggestion */
  confidence: number;
}

const MIN_SAMPLE = 5; // don't judge an agent on anecdote
const LOW_SCORE = 0.45;
const HIGH_LATENCY_MS = 1500;

/**
 * The Evaluator — sub-agent under the Leader (ADR-008).
 * Reads live fleet metrics and issues ranked evolution proposals. It has zero
 * authority to MUTATE anything: it writes memos, the Leader's owner decides,
 * and the Evolution service is the only hand allowed to act (ADR-009).
 */
@Injectable()
export class EvaluatorService {
  /** Pure input → output. Deterministic rules only (ADR-003). */
  evaluate(metrics: readonly AgentMetrics[]): EvolutionSuggestion[] {
    const out: EvolutionSuggestion[] = [];
    let n = 0;
    const id = () => `evo-${Date.now()}-${(n += 1)}`;

    for (const m of metrics) {
      const sample = m.completed + m.failed;
      if (m.agentId === 'unrouted') {
        if (m.failed >= MIN_SAMPLE) {
          out.push({
            id: id(),
            agentId: null,
            kind: 'spawn_role',
            summaryFa: `${m.failed} پرسش بدون پاسخِ جامعه مانده است — احتمالاً نقش جدیدی لازم است.`,
            evidence: { unroutedFailures: m.failed },
            confidence: 0.7,
          });
        }
        continue;
      }
      if (sample < MIN_SAMPLE) continue;

      if (m.successRate !== null && m.successRate < 0.6) {
        out.push({
          id: id(),
          agentId: m.agentId,
          kind: 'review_grants',
          summaryFa: `نرخ موفقیت ${m.agentId} به ${(m.successRate * 100).toFixed(0)}٪ رسیده؛ اول وضعیت گرنت/سلامت را بررسی کنید.`,
          evidence: { successRate: m.successRate, denials: m.denials },
          confidence: 0.8,
        });
      }
      if (m.avgRouteScore !== null && m.avgRouteScore < LOW_SCORE) {
        out.push({
          id: id(),
          agentId: m.agentId,
          kind: 'split_vocabulary',
          summaryFa: `میانگین امتیاز مسیریابی ${m.agentId} پایین است (${m.avgRouteScore}) — واژگان را تفکیک/غنی کنید.`,
          evidence: { avgRouteScore: m.avgRouteScore, samples: sample },
          confidence: 0.6,
        });
      }
      if (m.avgDurationMs !== null && m.avgDurationMs > HIGH_LATENCY_MS) {
        const cloudShare = m.cloudRuns / Math.max(1, m.localRuns + m.cloudRuns);
        out.push({
          id: id(),
          agentId: m.agentId,
          kind: 'tune_hybrid_policy',
          summaryFa: `تأخیر ${m.agentId} بالاست (~${m.avgDurationMs}ms، سهم ابری ${(cloudShare * 100).toFixed(0)}٪) — سیاست هیبرید/سکوی محلی را بازبینی کنید.`,
          evidence: { avgDurationMs: m.avgDurationMs, localRuns: m.localRuns, cloudRuns: m.cloudRuns },
          confidence: 0.55,
        });
      }
    }

    return out.sort((a, b) => b.confidence - a.confidence);
  }
}
