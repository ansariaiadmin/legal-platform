'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react';
import { getPrefs, num, setPrefs, t, prefsEventName, type TranslationKey } from '@/i18n';
import { WIZARD_FINISHED_EVENT } from './setup-wizard';

/**
 * P7 onboarding tour — one engine, one data table. Steps are pure i18n keys,
 * so the guide walks ENGLISH operators and PERSIAN lawyers with the same
 * code, and a per-tab restart is always available (no "you saw it once,
 * figure the rest out yourself").
 *
 * `tryKey` is optional: when set, the card offers an action button; the host
 * tab listens for `tour:try:<key>` CustomEvents and fills its own real content (e.g. Article 10 of the Civil Code).
 * The tour engine NEVER pokes component internals — it asks politely by
 * event, so tabs stay free-standing.
 */

interface TourStep {
  key: `tour.${string}`;
  title: TranslationKey;
  body: TranslationKey;
  tabId: string; // which tab it belongs to ('*' = welcome)
  tryKey?: string; // optional action event id (fills real content in the host tab)
}

export const TOUR_STEPS: readonly TourStep[] = [
  { key: 'tour.welcome', title: 'tour.welcome.title', body: 'tour.welcome.body', tabId: '*' },
  { key: 'tour.home', title: 'tour.home.title', body: 'tour.home.body', tabId: 'home' },
  { key: 'tour.brain', title: 'tour.brain.title', body: 'tour.brain.body', tabId: 'brain' },
  { key: 'tour.fleet', title: 'tour.fleet.title', body: 'tour.fleet.body', tabId: 'fleet' },
  { key: 'tour.chat', title: 'tour.chat.title', body: 'tour.chat.body', tabId: 'chat' },
  { key: 'tour.files', title: 'tour.files.title', body: 'tour.files.body', tabId: 'files' },
  { key: 'tour.kitchen', title: 'tour.kitchen.title', body: 'tour.kitchen.body', tabId: 'kitchen' },
  { key: 'tour.telecoms', title: 'tour.telecoms.title', body: 'tour.telecoms.body', tabId: 'telecoms' },
  { key: 'tour.library', title: 'tour.library.title', body: 'tour.library.body', tabId: 'library', tryKey: 'library' },
  { key: 'tour.drafts', title: 'tour.drafts.title', body: 'tour.drafts.body', tabId: 'drafts', tryKey: 'drafts' },
  { key: 'tour.security', title: 'tour.security.title', body: 'tour.security.body', tabId: 'security', tryKey: 'security' },
] as const;

export function Tour({
  activeTab,
  onNavigate,
}: {
  activeTab: string;
  onNavigate: (tab: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);

  // first-visit auto-open
  // First visit: the tour starts once the setup wizard is finished, so the
  // two never compete for the owner's attention.
  useEffect(() => {
    const onWizardDone = () => {
      if (!getPrefs().tourSeen) setOpen(true);
    };
    window.addEventListener(WIZARD_FINISHED_EVENT, onWizardDone);
    return () => window.removeEventListener(WIZARD_FINISHED_EVENT, onWizardDone);
  }, []);

  // header 💡 + per-tab restart events
  useEffect(() => {
    const openHandler = () => {
      // restart at the current tab's step if there is one, else welcome
      const hit = TOUR_STEPS.findIndex((s) => s.tabId === activeTab);
      setIdx(hit >= 0 ? hit : 0);
      setOpen(true);
    };
    window.addEventListener('tour:open', openHandler);
    return () => window.removeEventListener('tour:open', openHandler);
  }, [activeTab]);

  // re-render when language flips mid-tour
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    window.addEventListener(prefsEventName(), bump);
    return () => window.removeEventListener(prefsEventName(), bump);
  }, []);

  if (!open) return null;

  const step = TOUR_STEPS[Math.min(idx, TOUR_STEPS.length - 1)];
  const go = (delta: number) => {
    const nextIdx = Math.min(Math.max(idx + delta, 0), TOUR_STEPS.length - 1);
    setIdx(nextIdx);
    const target = TOUR_STEPS[nextIdx];
    if (target.tabId !== '*') onNavigate(target.tabId);
  };
  const finish = () => {
    setPrefs({ tourSeen: true });
    setOpen(false);
  };
  const trySample = () => {
    if (step.tryKey) {
      window.dispatchEvent(new CustomEvent(`tour:try:${step.tryKey}`));
    }
  };

  return (
    <div className="tour-card" role="dialog" aria-labelledby="tour-title">
      <h4 id="tour-title">{t(step.title)}</h4>
      <p>{t(step.body)}</p>
      <div className="tour-actions">
        <button type="button" className="btn ghost small" onClick={() => go(-1)} disabled={idx === 0}>
          <ArrowRight size={15} aria-hidden="true" className="flip-ltr" />
          {t('tour.prev')}
        </button>
        {idx < TOUR_STEPS.length - 1 ? (
          <button type="button" className="btn primary small" onClick={() => go(1)}>
            {t('tour.next')}
            <ArrowLeft size={15} aria-hidden="true" className="flip-ltr" />
          </button>
        ) : (
          <button type="button" className="btn primary small" onClick={finish}>
            <Check size={15} aria-hidden="true" />
            {t('tour.done')}
          </button>
        )}
        {step.tryKey && (
          <button type="button" className="btn ghost small" onClick={trySample}>
            <Sparkles size={15} aria-hidden="true" />
            {t(`tour.${step.tryKey}.try` as TranslationKey)}
          </button>
        )}
        <button type="button" className="btn ghost small" onClick={finish}>
          {t('tour.skip')}
        </button>
        <span className="tour-stepper">
          {t('tour.stepIndicator')} {num(idx + 1)} {t('tour.of')} {num(TOUR_STEPS.length)}
        </span>
      </div>
    </div>
  );
}
