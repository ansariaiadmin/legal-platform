import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { AgentTask, CollectedItem, CollectorRunResult, ICollectorAgent } from '@legal-platform/shared';

/**
 * P2-T2: collector agents mock-first behind a per-source ADAPTER interface
 * (SPEC §9). Real rooznameh-rasmi/pajouhesh adapters plug in later by
 * implementing the same `CollectorSourceAdapter` contract — until then the
 * mock keeps the whole lifecycle (collect → validate → shelve → supersede)
 * exercisable end to end with deterministic fixtures, NO network magic.
 *
 * Fixtures carry trust-honest bodies: tier-1 items include an official
 * publication marker («روزنامه رسمی») so the validator can pass them; the
 * `FAIL` magic word simulates a wire failure so partial_success accounting
 * is exercised for real.
 */
export interface CollectorSourceAdapter {
  readonly sourceId: string;
  /** Collected items for one sync window; throwing mid-way is allowed — the
   *  worker converts throws into `failed` counts, never into fake items. */
  fetchLatest(windowLabel: string): Promise<Array<{ canonicalTitle: string; bodyRaw: string }>>;
}

@Injectable()
export class CollectorAgentService implements Pick<ICollectorAgent, 'collect'> {
  private readonly adapters = new Map<string, CollectorSourceAdapter>();

  constructor() {
    // mock-first fixtures: deterministic content so tests + the manual
    // dashboard "sync now" button both behave identically
    this.register({
      sourceId: 'rooznameh-mock',
      fetchLatest: async (windowLabel) => [
        {
          canonicalTitle: 'قانون روزنامه‌نمونه ۱۴۰۵ (fixture)',
          bodyRaw:
            `مصوبهٔ نمونه برای پنجرهٔ ${windowLabel}: این قانون با انجام سهم مجلس شورای اسلامی به اجرا گذارده شد ` +
            'و متن آن در روزنامه رسمی چاپ گردید. ماده ۱ — هدف قانون پیش‌برد شفافیت امور حقوقی است. ' +
            'ماده ۲ — مراجع موظف‌اند نسخهٔ صحیح را منطبق با نسخهٔ چاپی روزنامه رسمی منتشر کنند. '.repeat(4),
        },
        {
          canonicalTitle: 'آیین‌نامه‌نمونه اجرایی (fixture)',
          bodyRaw:
            'این آیین‌نامه نمونه‌ای است برای تمرین چرخهٔ گردآوری؛ وزارت مسئول آن را بر پایهٔ قانون مربوط تنظیم کرده ' +
            'و در روزنامه رسمی به چاپ رسیده است. ماده ۱ — تعاریف. ماده ۲ — ترتیب اجرا. '.repeat(4),
        },
        // the wire-failure fixture: the worker must COUNT it, not invent it
        { canonicalTitle: 'FIXTURE_FAIL', bodyRaw: 'FAIL' },
      ],
    });
  }

  register(adapter: CollectorSourceAdapter): void {
    this.adapters.set(adapter.sourceId, adapter);
  }

  listSources(): string[] {
    return [...this.adapters.keys()];
  }

  async collect(task: AgentTask): Promise<CollectorRunResult> {
    const sourceId = String(task.context?.[0] ?? 'rooznameh-mock');
    const windowLabel = String(task.context?.[1] ?? new Date().toISOString().slice(0, 10));
    const adapter = this.adapters.get(sourceId);
    if (!adapter) {
      return { jobId: randomUUID(), items: [], attempted: 0, succeeded: 0, failed: 0 };
    }

    const raw = await adapter.fetchLatest(windowLabel);
    const items: CollectedItem[] = [];
    let failed = 0;
    for (const item of raw) {
      try {
        if (item.bodyRaw.trim() === 'FAIL') throw new Error('fixture wire failure');
        const rawText = `${item.canonicalTitle}\n${item.bodyRaw}`;
        items.push({
          sourceUrl: `mock://${sourceId}/${windowLabel}`,
          fetchedAt: new Date().toISOString(),
          contentSha256: createHash('sha256').update(rawText, 'utf8').digest('hex'), // hash the thing you ship
          rawText,
          trustTier: 1,
        });
      } catch {
        failed += 1;
      }
    }
    return {
      jobId: randomUUID(),
      items,
      attempted: raw.length,
      succeeded: items.length,
      failed,
    };
  }
}
