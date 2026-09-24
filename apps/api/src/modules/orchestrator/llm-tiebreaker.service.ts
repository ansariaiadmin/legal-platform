import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { IntentKind, LegalField } from '@legal-platform/domain';
import { AI_PROVIDER } from '../../providers/provider.tokens';
import type { AIProvider } from '../../providers/ai/ai.provider';
import { LOW_CONFIDENCE, type IntentClassification } from './intent-classifier';

/**
 * P3-T2: the bounded LLM tiebreaker (SPEC §9 "Layered AI", ADR-003).
 *
 * The deterministic classifier decides when confident (≥ LOW_CONFIDENCE) and
 * we never route purely on vibe. ONLY below that bar do we pay for an LLM
 * second opinion — behind `providers/ai`, JSON-only, schema-validated, and
 * NEVER on privileged input (secrecy law from ADR-004 covers data, so a
 * private query keeps deterministic routing rather than leaking to a cloud
 * call just to figure out WHO to ask).
 *
 * Failure grammar is explicit: 'not_needed' | 'unavailable' |
 * 'skipped_privileged' | 'llm_rejected' (bad JSON / out-of-enum /
 * timeout) | 'llm_applied'. The route trace records exactly which.
 */

export type TiebreakerOutcome =
  | 'not_needed'
  | 'unavailable'
  | 'skipped_privileged'
  | 'llm_rejected'
  | 'llm_applied';

export interface TiebreakResult {
  classification: IntentClassification;
  changed: boolean;
  outcome: TiebreakerOutcome;
  /** model identity when a call actually happened */
  model?: string;
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number };
}

const TIEBREAK_TIMEOUT_MS = 4_000;

@Injectable()
export class LlmTiebreakerService {
  private readonly logger = new Logger(LlmTiebreakerService.name);

  constructor(
    @Optional() @Inject(AI_PROVIDER) private readonly ai?: AIProvider,
  ) {}

  /** Resolve a low-confidence classification; everything we did is named. */
  async resolve(
    query: string,
    current: IntentClassification,
    sensitivity?: 'privileged' | 'normal',
  ): Promise<TiebreakResult> {
    if (current.confidence >= LOW_CONFIDENCE) {
      return { classification: current, changed: false, outcome: 'not_needed' };
    }
    if (!this.ai) {
      return { classification: current, changed: false, outcome: 'unavailable' };
    }
    if (sensitivity === 'privileged') {
      return { classification: current, changed: false, outcome: 'skipped_privileged' };
    }

    const fields = Object.values(LegalField).join('|');
    const kinds = Object.values(IntentKind).join('|');
    const systemPrompt = [
      'تو دسته‌بندِ درخواست‌های حقوقی هستی. فقط یک شیء JSON برگردان؛ هیچ کلمهٔ دیگری ننویس.',
      `قالب: {"field":"${fields}","kind":"${kinds}"}. مقدار field فقط از فهرست بالا انتخاب کن.`,
    ].join('\n');

    try {
      const res = await withTimeout(
        this.ai.generateText({
          prompt: `درخواست: «${query.slice(0, 300)}»`,
          systemPrompt,
          temperature: 0,
          maxTokens: 120,
        }),
        TIEBREAK_TIMEOUT_MS,
      );
      const parsed = parseTiebreakJson(res.text);
      if (!parsed) {
        this.logger.warn(`tiebreaker rejected invalid JSON: ${res.text.slice(0, 80)}`);
        return { classification: current, changed: false, outcome: 'llm_rejected', model: res.model, usage: res.usage };
      }
      const upgraded: IntentClassification = {
        kind: parsed.kind,
        field: parsed.field,
        // LLM hint earns a bounded bump — never a crown (still below confident)
        confidence: Math.max(current.confidence, LOW_CONFIDENCE + 0.15),
        matchedTerms: [...current.matchedTerms, `llm:${parsed.field}`],
      };
      const changed =
        upgraded.field !== current.field || upgraded.kind !== current.kind;
      return { classification: upgraded, changed, outcome: 'llm_applied', model: res.model, usage: res.usage };
    } catch (e) {
      this.logger.warn(`tiebreaker unavailable/unreachable: ${(e as Error).message.slice(0, 80)}`);
      return { classification: current, changed: false, outcome: 'unavailable' };
    }
  }
}

function parseTiebreakJson(text: string): { field: LegalField; kind: IntentKind } | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as { field?: string; kind?: string };
    const field = Object.values(LegalField).find((f) => f === o.field);
    const kind = Object.values(IntentKind).find((k) => k === o.kind);
    if (!field || !kind) return null;
    return { field, kind };
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tiebreaker_timeout')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
