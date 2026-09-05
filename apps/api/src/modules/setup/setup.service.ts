import { Inject, Injectable } from '@nestjs/common';
import { STORAGE_PROVIDER } from '../../providers/provider.tokens';
import type { StorageProvider } from '../../providers/storage/storage.provider';

/**
 * P8-T1 setup wizard — a persisted state machine so a lawyer with zero
 * technical background finishes the office setup step by step, from ANY
 * device, and can resume mid-way after a coffee. Steps are data (each one
 * maps to a real tab so the tour and the wizard never disagree), the wizard
 * only records what was ACTUALLY done — marking 'done' without payload
 * is refused for steps that carry config (brain, plans).
 */

export type WizardStepId =
  | 'welcome'
  | 'profile'
  | 'brain'
  | 'plans'
  | 'library'
  | 'backup'
  | 'security'
  | 'done';

export interface WizardStep {
  id: WizardStepId;
  /** tab the step pairs with — the web wizard navigates there as you go */
  tab: string;
  requiresPayload: boolean;
  /** seeded default payloads the wizard suggests (owner confirms, never forced) */
  defaultPayload: Record<string, unknown>;
}

export const WIZARD_STEPS: readonly WizardStep[] = [
  { id: 'welcome', tab: 'home', requiresPayload: false, defaultPayload: {} },
  {
    id: 'profile',
    tab: 'brain',
    requiresPayload: true,
    defaultPayload: { defaultLocale: 'fa', country: 'Iran', currency: 'IRT', timezone: 'Asia/Tehran' },
  },
  {
    id: 'brain',
    tab: 'brain',
    requiresPayload: true,
    defaultPayload: { preset: 'counsel' },
  },
  {
    id: 'plans',
    tab: 'telecoms',
    requiresPayload: true,
    defaultPayload: { durationsMin: [10, 20, 30] },
  },
  { id: 'library', tab: 'library', requiresPayload: true, defaultPayload: { note: 'shelf at least one verified source' } },
  { id: 'backup', tab: 'security', requiresPayload: false, defaultPayload: { action: 'download a bundle' } },
  { id: 'security', tab: 'security', requiresPayload: false, defaultPayload: { action: 'set area password + register a passkey' } },
  { id: 'done', tab: 'home', requiresPayload: false, defaultPayload: {} },
] as const;

export interface WizardState {
  current: WizardStepId;
  completed: WizardStepId[];
  payloads: Partial<Record<WizardStepId, Record<string, unknown>>>;
  startedAt: string;
  finishedAt: string | null;
  byUserId: string;
}

const KEY = 'runtime/setup/wizard.json';

@Injectable()
export class SetupWizardService {
  private state: WizardState | null = null;

  constructor(@Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider) {}

  private async ensure(): Promise<WizardState | null> {
    if (this.state) return this.state;
    try {
      const raw = await this.storage.get(KEY);
      this.state = JSON.parse(raw.toString('utf8')) as WizardState;
    } catch {
      this.state = null;
    }
    return this.state;
  }

  async status(): Promise<{
    started: boolean;
    finished: boolean;
    current: WizardStepId | null;
    steps: WizardStep[];
    completed: WizardStepId[];
  }> {
    const st = await this.ensure();
    return {
      started: st !== null,
      finished: st?.finishedAt != null,
      current: st?.current ?? null,
      steps: [...WIZARD_STEPS],
      completed: st?.completed ?? [],
    };
  }

  async start(byUserId: string): Promise<WizardState> {
    const existing = await this.ensure();
    if (existing) return existing; // idempotent: resume, never restart over half-done work
    this.state = {
      current: 'welcome',
      completed: [],
      payloads: {},
      startedAt: new Date().toISOString(),
      finishedAt: null,
      byUserId,
    };
    await this.persist();
    return this.state;
  }

  /** Advance the wizard: complete the CURRENT step with payload, move next. */
  async advance(stepId: WizardStepId, payload: Record<string, unknown>, byUserId: string): Promise<WizardState> {
    const st = (await this.ensure()) ?? (await this.start(byUserId));
    const def = WIZARD_STEPS.find((s) => s.id === stepId);
    if (!def) throw new Error(`unknown step: ${stepId}`);
    if (st.current !== stepId) {
      throw new Error(`wizard is at '${st.current}', not '${stepId}' — resume from where it is`);
    }
    if (def.requiresPayload && (!payload || Object.keys(payload).length === 0)) {
      throw new Error(`step ${stepId} requires a payload — refusing silent skip`);
    }
    st.payloads[stepId] = { ...def.defaultPayload, ...(payload ?? {}) };
    if (!st.completed.includes(stepId)) st.completed.push(stepId);
    const idx = WIZARD_STEPS.findIndex((s) => s.id === stepId);
    const next = WIZARD_STEPS[idx + 1];
    st.current = next ? next.id : 'done';
    if (st.current === 'done' && stepId === 'done') {
      st.finishedAt = new Date().toISOString();
    }
    await this.persist();
    return st;
  }

  /** Completing 'done' finalizes; a finished wizard disappears from the UI. */
  async finish(byUserId: string): Promise<WizardState> {
    const st = await this.ensure();
    if (!st) throw new Error('wizard not started');
    if (st.current === 'done') {
      st.finishedAt = new Date().toISOString();
      if (!st.completed.includes('done')) st.completed.push('done');
      await this.persist();
    }
    void byUserId;
    return st;
  }

  /** Hard reset — owner only, e.g. after an office re-branding. */
  async reset(): Promise<void> {
    this.state = null;
    try {
      await this.storage.delete(KEY);
    } catch { /* absent is fine */ }
  }

  private async persist(): Promise<void> {
    await this.storage.put({ key: KEY, content: Buffer.from(JSON.stringify(this.state)), contentType: 'application/json' });
  }
}
