'use client';

import { useEffect, useState } from 'react';
import { Languages, Lightbulb, Moon, Sun } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import {
  DEFAULT_PREFS,
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
  // Start from the defaults so the server and first client render agree;
  // the stored prefs are read after mount.
  const [prefs, setLocal] = useState<UiPrefs>(DEFAULT_PREFS);

  // apply to document (single writer rule)
  useEffect(() => {
    const apply = (p: UiPrefs) => {
      document.documentElement.lang = p.locale;
      document.documentElement.dir = isRtl(p.locale) ? 'rtl' : 'ltr';
      document.body.dataset.theme = p.theme;
    };
    const initial = getPrefs();
    setLocal(initial);
    apply(initial);
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
    if (stored) return; // the user's own choice always wins
    if (!getToken()) return; // the office profile needs a session
    api
      .get<{ defaultLocale?: string }>('/dashboard/config/profile')
      .then((profile) => {
        const loc = profile?.defaultLocale;
        if (loc === 'en' || loc === 'fa') setPrefs({ locale: loc });
      })
      .catch(() => undefined);
  }, []);

  const flipLocale = () => setPrefs({ locale: prefs.locale === 'fa' ? 'en' : 'fa' });
  const flipTheme = () => setPrefs({ theme: prefs.theme === 'dark' ? 'light' : 'dark' });

  return (
    <div className="prefsbar">
      <button className="pill" onClick={flipLocale} title="فارسی / English">
        <Languages size={14} aria-hidden="true" />
        {t('chrome.lang')}
      </button>
      <button className="pill" onClick={flipTheme} title={t(prefs.theme === 'dark' ? 'chrome.theme.light' : 'chrome.theme.dark')}>
        {prefs.theme === 'dark' ? <Sun size={14} aria-hidden="true" /> : <Moon size={14} aria-hidden="true" />}
        {prefs.theme === 'dark' ? t('chrome.theme.light') : t('chrome.theme.dark')}
      </button>
      <button
        className="pill violet"
        onClick={() => window.dispatchEvent(new Event('tour:open'))}
        title={t('chrome.tour')}
      >
        <Lightbulb size={14} aria-hidden="true" />
        {t('chrome.tour')}
      </button>
    </div>
  );
}
