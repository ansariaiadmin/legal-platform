import { Injectable } from '@nestjs/common';
import { ExpertRegistry } from './expert-registry';
import type { FileRecord } from './file-intelligence.service';

export interface PlacementSuggestion {
  /** the fleet member best suited to own this file */
  agentId: string | null;
  skillId: string | null;
  score: number;
  /** proposed collection name, e.g. 'contracts' — Phase 2 corpus bucket */
  collection: string;
  /** human-readable reasoning shown in the dashboard (Persian) */
  rationaleFa: string;
  /** content signals behind the pick, for auditability */
  signals: { previewLength: number; kindGuess: string; languageHint?: string };
}

/**
 * Placement advisor (P1e): after the Leader reads an uploaded file, it
 * computes WHERE in the corpus it belongs by scoring the preview against the
 * SOCIETY'S OWN skills — the same vocabularyScore the tree routes with, so a
 * file always walks toward the agent that would answer its questions.
 * The human still presses the button (advise ≠ move).
 */
@Injectable()
export class PlacementService {
  constructor(private readonly registry: ExpertRegistry) {}

  async suggest(record: FileRecord): Promise<PlacementSuggestion> {
    const preview = record.analysis?.preview ?? '';
    const query = `${record.filename} ${preview}`.trim();

    let best: { agentId: string; skillId: string; score: number } | null = null;
    for (const agent of this.registry.list()) {
      for (const skill of agent.capabilities()) {
        const score = skill.match({ query });
        if (!best || score > best.score) {
          best = { agentId: agent.agentId, skillId: skill.id, score };
        }
      }
    }

    const strong = best !== null && best.score >= 0.3;
    const picked = strong ? best : null;
    const collection = picked ? picked.skillId.split(':')[1] ?? 'general-inbox' : 'needs-review';

    return {
      agentId: picked?.agentId ?? null,
      skillId: picked?.skillId ?? null,
      score: best?.score ?? 0,
      collection,
      rationaleFa: picked
        ? `${record.filename} بیشترین هم‌پوشانی را با مهارت «${picked.skillId}» دارد — پیشنهاد می‌شود در مجموعه «${collection}» نزد ${picked.agentId} قرار گیرد.`
        : `محتوای ${record.filename} به هیچ‌یک از مهارت‌های فعلی نزدیکی کافی ندارد؛ در «needs-review» بماند تا وکیل دسته‌بندی کند.`,
      signals: {
        previewLength: preview.length,
        kindGuess: record.analysis?.kindGuess ?? 'unknown',
        languageHint: record.analysis?.languageHint,
      },
    };
  }
}
