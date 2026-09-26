'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, ExternalLink, Rocket } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { getPrefs, setPrefs, t, type TranslationKey } from '@/i18n';

/**
 * First-run setup wizard.
 *
 * The step list and progress live on the server (GET/POST /dashboard/setup),
 * so the wizard resumes where it stopped, on any device. The panel is docked
 * rather than modal: most steps ask the owner to do something in another
 * section, and that section has to stay usable while the panel is open.
 *
 * Steps with settings apply them for real before advancing:
 *   profile → POST /dashboard/config/profile (and switches the UI language)
 *   brain   → POST /dashboard/config/preset
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

type Preset = 'spartan' | 'counsel' | 'senator';
const PRESETS: Preset[] = ['spartan', 'counsel', 'senator'];

/** Fired when the wizard is finished, so the guided tour can start. */
export const WIZARD_FINISHED_EVENT = 'legal-platform:wizard-finished';

export function SetupWizardOverlay({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [status, setStatus] = useState<WizardStatus | null>(null);
  const [hidden, setHidden] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [locale, setLocale] = useState<'fa' | 'en'>('fa');
  const [country, setCountry] = useState('Iran');
  const [preset, setPreset] = useState<Preset>('counsel');

  const refresh = useCallback(async () => {
    try {
      let s = await api.get<WizardStatus>('/dashboard/setup');
      if (!s.started) {
        // First sign-in of the office: start the wizard (idempotent server-side).
        await api.post('/dashboard/setup/start', {});
        s = await api.get<WizardStatus>('/dashboard/setup');
      }
      setStatus(s);
      if (s.finished) window.dispatchEvent(new Event(WIZARD_FINISHED_EVENT));
    } catch {
      setStatus(null); // no permission or API unavailable: stay out of the way
    }
  }, []);

  useEffect(() => {
    setLocale(getPrefs().locale);
    // On phones the panel starts collapsed so it does not cover the page.
    if (window.matchMedia('(max-width: 640px)').matches) setCollapsed(true);
    void refresh();
  }, [refresh]);

  if (hidden || !status || status.finished || !status.current) return null;
  const idx = status.steps.findIndex((s) => s.id === status.current);
  const current = status.steps[idx];
  if (!current) return null;
  const isLast = current.id === 'done';

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('wizard.error'));
    } finally {
      setBusy(false);
    }
  };

  const advance = () =>
    run(async () => {
      let payload: Record<string, unknown> = {};
      if (current.id === 'profile') {
        await api.post('/dashboard/config/profile', { defaultLocale: locale, country: country.trim() || 'Iran' });
        setPrefs({ locale });
        payload = { defaultLocale: locale, country: country.trim() || 'Iran' };
      } else if (current.id === 'brain') {
        await api.post('/dashboard/config/preset', { preset });
        payload = { preset };
      } else if (current.requiresPayload) {
        payload = { ...current.defaultPayload };
      }
      await api.post('/dashboard/setup/advance', { stepId: current.id, payload });
      const next = status.steps[idx + 1];
      if (next?.tab) onNavigate(next.tab);
      await refresh();
    });

  const finish = () =>
    run(async () => {
      await api.post('/dashboard/setup/advance', { stepId: 'done', payload: {} }).catch(() => undefined);
      await api.post('/dashboard/setup/finish', {});
      onNavigate('home');
      await refresh();
    });

  const stepKey = (suffix: 'title' | 'body') => `wizard.step.${current.id}.${suffix}` as TranslationKey;

  return (
    <aside className={`wizard-dock ${collapsed ? 'collapsed' : ''}`} aria-labelledby="wizard-title">
      <header className="wizard-head">
        <Rocket size={18} aria-hidden="true" />
        <b id="wizard-title">{t('wizard.title')}</b>
        <span className="wizard-count">
          {t('wizard.stepOf')
            .replace('{n}', (idx + 1).toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US'))
            .replace('{total}', status.steps.length.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US'))}
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('wizard.expand') : t('wizard.collapse')}
        >
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </header>

      <div className="wizard-progress" aria-hidden="true">
        {status.steps.map((s) => (
          <span
            key={s.id}
            className={status.completed.includes(s.id) ? 'done' : s.id === status.current ? 'current' : ''}
          />
        ))}
      </div>

      {!collapsed && (
        <div className="wizard-body">
          <h4>{t(stepKey('title'))}</h4>
          <p>{t(stepKey('body'))}</p>

          {current.id === 'profile' && (
            <div className="wizard-form">
              <div className="segmented" role="radiogroup" aria-label={t('wizard.profile.language')}>
                {(['fa', 'en'] as const).map((loc) => (
                  <button
                    key={loc}
                    type="button"
                    role="radio"
                    aria-checked={locale === loc}
                    className={`tab ${locale === loc ? 'active' : ''}`}
                    onClick={() => setLocale(loc)}
                  >
                    {loc === 'fa' ? 'فارسی' : 'English'}
                  </button>
                ))}
              </div>
              <div className="field">
                <label htmlFor="wizard-country">{t('wizard.profile.country')}</label>
                <input id="wizard-country" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
          )}

          {current.id === 'brain' && (
            <div className="wizard-form" role="radiogroup" aria-label={t('home.preset')}>
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={preset === p}
                  className={`choice ${preset === p ? 'active' : ''}`}
                  onClick={() => setPreset(p)}
                >
                  <b>{t(`brain.tier.${p}` as TranslationKey)}</b>
                  <small>{t(`brain.tier.${p}.hint` as TranslationKey)}</small>
                </button>
              ))}
            </div>
          )}

          {err && <p className="form-error" role="alert">{err}</p>}

          <div className="wizard-actions">
            {isLast ? (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void finish()}>
                <Check size={16} aria-hidden="true" />
                {t('wizard.finish')}
              </button>
            ) : (
              <button type="button" className="btn primary" disabled={busy} onClick={() => void advance()}>
                <Check size={16} aria-hidden="true" />
                {current.id === 'welcome' ? t('wizard.start') : t('wizard.advance')}
              </button>
            )}
            {current.tab && current.tab !== 'home' && (
              <button type="button" className="btn ghost small" onClick={() => onNavigate(current.tab)}>
                <ExternalLink size={15} aria-hidden="true" />
                {t('wizard.openSection')}
              </button>
            )}
            <button type="button" className="btn ghost small" onClick={() => setHidden(true)}>
              {t('wizard.later')}
            </button>
          </div>
          <small className="wizard-hint">{t('wizard.resumeHint')}</small>
        </div>
      )}
    </aside>
  );
}
