'use client';

import { useEffect, useState } from 'react';
import {
  getPrefs,
  setPrefs,
  t,
  isRtl,
  prefsEventName,
  type UiPrefs,
} from '@/i18n';

/**
 * P7 prefs bar + applier: language toggle (fa ⇄ en), day/night theme, tour
 * launcher — and the COMPONENT THAT APPLIES the prefs: `<html dir/lang>` and
 * `<body data-theme>` mutate here, nowhere else, so there is exactly one
 * place that knows how the shell looks.
 *
 * First visit: adopts the org's deployment-profile locale (server default)
 * when the user has never chosen — afterwards the USER'S choice always wins.
 */
export function UiPrefsBar() {
  const [prefs, setLocal] = useState<UiPrefs>(getPrefs());

  // apply to document (single writer rule)
  useEffect(() => {
    const apply = (p: UiPrefs) => {
      document.documentElement.lang = p.locale;
      document.documentElement.dir = isRtl(p.locale) ? 'rtl' : 'ltr';
      document.body.dataset.theme = p.theme;
    };
    apply(prefs);
    const onChange = () => {
      const p = getPrefs();
      setLocal(p);
      apply(p);
    };
    window.addEventListener(prefsEventName(), onChange);
    return () => window.removeEventListener(prefsEventName(), onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // first-visit org default from the deployment profile (best-effort; the
  // office decides its language — a missing API just keeps local default)
  useEffect(() => {
    const stored = window.localStorage.getItem('legal-platform:ui-prefs');
    if (stored) return; // user already chose — never override their voice
    fetch('/api/dashboard/config/profile')
      .then((r) => (r.ok ? r.json() : null))
      .then((profile) => {
        const loc = profile?.defaultLocale;
        if (loc === 'en' || loc === 'fa') setPrefs({ locale: loc });
      })
      .catch(() => undefined);
  }, []);

  const flipLocale = () => setPrefs({ locale: prefs.locale === 'fa' ? 'en' : 'fa' });
  const flipTheme = () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' });

  return (
    <div className="prefsbar" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button className="pill" onClick={flipLocale} title="fa ⇄ en" style={{ minWidth: 72 }}>
        {t('chrome.lang')}
      </button>
      <button className="pill" onClick={flipTheme} title="day / night">
        {prefs.theme === 'dark' ? `☀️ ${t('chrome.theme.light')}` : `🌙 ${t('chrome.theme.dark')}`}
      </button>
      <button
        className="pill violet"
        onClick={() => window.dispatchEvent(new Event('tour:open'))}
        title={t('chrome.tour')}
      >
        💡 {t('chrome.tour')}
      </button>
    </div>
  );
}
