'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { t } from '@/i18n';

/**
 * P8 setup wizard — first-run overlay. State machine lives SERVER-SIDE
 * (resumable across devices, honest persistence); this component just walks
 * the current step card and posts payloads. Steps that belong to a tab
 * navigate you there; steps with config need a minimal form, never a guess.
 */

interface WizardStep {
  id: string;
  tab: string;
  requiresPayload: boolean;
  defaultPayload: Record<string, unknown>;
}
interface WizardStatus {
  started: boolean;
  finished: boolean;
  current: string | null;
  steps: WizardStep[];
  completed: string[];
}

const OPTS: Record<string, Array<{ key: string; label: string }>> = {
  profile: [],
  brain: [],
};

export function SetupWizardOverlay({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const s = await api.get<WizardStatus>('/dashboard/setup');
      setStatus(s);
      setOpen(s.started && !s.finished);
    } catch { /* API down → hide */ }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!open || !status?.current) return null;

  const current = status.steps.find((s) => s.id === status.current);
  if (!current) return null;
  const idx = status.steps.findIndex((s) => s.id === status.current);

  const advance = async (payload: Record<string, unknown> | null) => {
    setBusy(true);
    try {
      await api.post('/dashboard/setup/advance', { stepId: current.id, payload: payload ?? {} });
      if (current.tab) onNavigate(current.tab);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setBusy(true);
    try {
      await api.post('/dashboard/setup/finish', {});
      setOpen(false);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const isLast = current.id === 'done';

  return (
    <div
      role="dialog"
      aria-modal
      style={{
        position: 'fixed', inset: 0, background: 'rgba(5,8,14,0.86)', backdropFilter: 'blur(6px)',
        zIndex: 90, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div style={{
        background: 'var(--bg-soft)', border: '1px solid var(--line)', borderRadius: 'var(--radius)',
        maxWidth: 520, width: '100%', padding: 24,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <b>{t('wizard.title')}</b>
          <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{idx + 1} / {status.steps.length}</span>
        </div>
        {/* progress beads */}
        <div style={{ display: 'flex', gap: 4, margin: '8px 0 16px' }}>
          {status.steps.map((s) => (
            <span
              key={s.id}
              style={{
                height: 6, flex: 1, borderRadius: 3,
                background: status.completed.includes(s.id)
                  ? 'var(--ok)'
                  : s.id === status.current
                    ? 'var(--teal)'
                    : 'var(--line)',
              }}
            />
          ))}
        </div>

        <h4 style={{ marginTop: 0 }}>{t(`wizard.step.${current.id}.title` as never)}</h4>
        <p style={{ color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.9 }}>
          {t(`wizard.step.${current.id}.body` as never)}
        </p>

        {current.id === 'profile' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <input placeholder={t('wizard.profile.country')} value={form.country ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))}
              style={{ padding: 10, borderRadius: 10, border: '1px solid var(--line)', background: 'transparent' }} />
            <div style={{ display: 'flex', gap: 8 }}>
              {(['fa', 'en'] as const).map((loc) => (
                <button key={loc} className={`pill ${(form.defaultLocale ?? 'fa') === loc ? 'teal' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, defaultLocale: loc }))} style={{ cursor: 'pointer' }}>
                  {loc === 'fa' ? 'فارسی' : 'English'}
                </button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {isLast ? (
            <button className="pill ok" disabled={busy} onClick={() => void finish()} style={{ cursor: 'pointer' }}>
              {t('wizard.finish')}
            </button>
          ) : (
            <button
              className="pill teal"
              disabled={busy}
              onClick={() =>
                void advance(
                  current.requiresPayload
                    ? { ...current.defaultPayload, ...form }
                    : {},
                )
              }
              style={{ cursor: 'pointer' }}
            >
              {busy ? '…' : t('wizard.advance')}
            </button>
          )}
          <button className="pill" onClick={() => setOpen(false)} style={{ cursor: 'pointer' }}>
            {t('wizard.later')}
          </button>
          <small style={{ marginInlineStart: 'auto', color: 'var(--text-dim)', alignSelf: 'center' }}>
            {t('wizard.resumeHint')}
          </small>
        </div>
        {OPTS && null /* placeholder keeps lint happy; per-step UIs live above */}
      </div>
    </div>
  );
}
