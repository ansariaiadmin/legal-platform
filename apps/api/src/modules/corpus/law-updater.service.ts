import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { IUpdaterAgent, AgentTask } from '@legal-platform/shared';
import { CorpusService } from './corpus.service';

/**
 * The updater hook (P2-T3): owns temporal truth for one canonical title.
 * When fresh text arrives for a title already on the shelf, the OLD row's
 * valid_to closes at the moment the NEW row's valid_from opens — the shelf
 * NEVER overwrites history; it appends a version (SPEC §9: "the law as of
 * day X" must remain answerable). SUPPRESSION is the updater's duty, storage
 * shape kicked by CorpusService.ingestDocument which enforces it via
 * sha256/UNIQUE + supersession pointer.
 */

export interface UpdateOutcome {
  changed: boolean;
  supersededId?: string;
  document?: { documentId: string; validFrom: string; validTo: string | null; supersedes: string | null };
}

@Injectable()
export class LawUpdaterService implements Pick<IUpdaterAgent, 'diff'> {
  constructor(private readonly corpus: CorpusService) {}

  /** Compare incoming text against the current version of a title. */
  async diff(task: AgentTask): Promise<{
    changed: boolean;
    newVersion?: { validFrom: string; validTo: string | null; supersedes?: string };
  }> {
    // task.context carries [canonicalTitle, newText] from the scheduler/agent
    const [title, newText] = task.context ?? [];
    if (!title || !newText) return { changed: false };

    const incomingSha = createHash('sha256').update(newText, 'utf8').digest('hex');
    const current = (await this.corpus.list()).find((d) => d.canonicalTitle === title);

    if (current && current.sha256 === incomingSha) return { changed: false };
    return {
      changed: true,
      newVersion: {
        validFrom: new Date().toISOString(),
        validTo: null,
        supersedes: current?.documentId,
      },
    };
  }

  /**
   * Apply the supersession: close current row's time window, append the new
   * version as its own row. Returns per-version facts the caller can log.
   */
  async applyUpdate(input: {
    canonicalTitle: string;
    bodyRaw: string;
    sourceKey: string;
    trustTier: 1 | 2 | 3;
    ingestedBy: string;
  }): Promise<UpdateOutcome> {
    const before = (await this.corpus.list()).find((d) => d.canonicalTitle === input.canonicalTitle);
    const doc = await this.corpus.ingestDocument(input);
    // ingestDocument returns the existing row on sha256 equality → that is "no change", told honestly
    if (before && doc.documentId === before.documentId) return { changed: false };
    return {
      changed: true,
      supersededId: doc.supersedesId ?? undefined,
      document: {
        documentId: doc.documentId,
        validFrom: doc.validFrom,
        validTo: doc.validTo,
        supersedes: doc.supersedesId,
      },
    };
  }
}
