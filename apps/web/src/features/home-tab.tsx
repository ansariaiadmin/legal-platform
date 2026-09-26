'use client';

import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { api, type BrainView } from '@/lib/api';
import { Kpi, Skeleton } from '@/components/ui';

const TIER_ICON: Record<string, string> = { spartan: '🟢', counsel: '🟡', senator: '🔴' };
const TIER_KEY: Record<string, 'brain.tier.spartan' | 'brain.tier.counsel' | 'brain.tier.senator'> = {
  spartan: 'brain.tier.spartan',
  counsel: 'brain.tier.counsel',
  senator: 'brain.tier.senator',
};

interface DeploymentView {
  mode: 'single' | 'multi';
  capabilities: {
    rateLimiterDriver?: string;
    sharedStorageDriver?: string;
    multiReplicaSafe?: boolean;
  };
  warnings?: string[];
}

function greetingKey(): 'home.greeting.morning' | 'home.greeting.afternoon' | 'home.greeting.evening' {
  const h = new Date().getHours();
  if (h < 12) return 'home.greeting.morning';
  if (h < 17) return 'home.greeting.afternoon';
  return 'home.greeting.evening';
}

/**
 * P10 home — bento hero. Psychology map:
 *  - Hero speaks FIRST (largest surface ⇒ read first) with a time-aware
 *    greeting (user feels seen, not processed).
 *  - KPIs whisper labels and shout numbers (visual hierarchy by size).
 *  - System truth is ONE tap of progressive disclosure away — calm by
 *    default, honest on demand.
 */
export function HomeTab({ brain, goTab }: { brain: BrainView | null; goTab: (t: 'brain' | 'chat' | 'kitchen' | 'fleet' | 'files' | 'home') => void }) {
  const [dep, setDep] = useState<DeploymentView | null>(null);

  useEffect(() => {
    api.get<DeploymentView>('/dashboard/ops/deployment').then(setDep).catch(() => setDep(null));
  }, []);

  const brainOn = Boolean(brain?.local.baseUrl || brain?.cloud.apiKeyMasked);

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="bento">
        <div className="card span-3" style={{ padding: 26 }}>
          <p className="hint" style={{ margin: '0 0 4px' }}>{t(greetingKey() as never)} 👋</p>
          <h2 style={{ marginTop: 0 }}>{t('home.title')}</h2>
          <p className="hint" style={{ maxWidth: 560 }}>
            {brain?.lendingScenario ?? <Skeleton count={2} width={70} />}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <span className="pill gold">{TIER_ICON[brain?.preset ?? 'counsel']} {t('home.preset')}: {t(TIER_KEY[brain?.preset ?? 'counsel'] ?? 'brain.tier.counsel')}</span>
            <span className="pill teal">{t('home.policy')}: {brain?.effectivePolicy ?? '—'}</span>
          </div>
        </div>

        <Kpi
          label={t('home.kpi.brain' as never)}
          figure={brainOn ? '🧠' : '🔌'}
          sub={brainOn ? t('home.kpi.brain.on' as never) : t('home.kpi.brain.off' as never)}
          tone={brainOn ? 'ok' : 'bad'}
        />

        <Jump emoji="💬" title={t('tab.chat')} body="پرسش حقوقی بپرسید، فایل بفرستید یا دستور تنظیمات بدهید." onClick={() => goTab('chat')} />
        <Jump emoji="🧠" title={t('tab.brain')} body="نشانی مدل محلی یا کلید سرویس ابری را وارد کنید؛ تغییر بلافاصله اعمال می‌شود." onClick={() => goTab('brain')} />
        <Jump emoji="🍳" title={t('tab.kitchen')} body="ببینید کدام دستیار، با کدام مهارت و روی کدام مدل کار می‌کند." onClick={() => goTab('kitchen')} />
        <Jump emoji="👥" title={t('tab.fleet')} body="مهارت‌ها، وضعیت و مجوزهای هر دستیار تخصصی." onClick={() => goTab('fleet')} />
        <Jump emoji="📁" title={t('tab.files')} body="فایل بارگذاری کنید؛ پیش از هر پاسخ خوانده می‌شود و محل نگهداری آن پیشنهاد می‌شود." onClick={() => goTab('files')} />
      </div>

      <details className="reveal">
        <summary>{t('home.system.details' as never)}</summary>
        {dep ? (
          <div>
            <div className="kv"><b>{t('home.kpi.deployment' as never)}</b><span className="ltr bidi">{dep.mode}</span></div>
            <div className="kv"><b>rate limiter</b><span className="ltr bidi">{dep.capabilities.rateLimiterDriver ?? '—'}</span></div>
            <div className="kv"><b>storage</b><span className="ltr bidi">{dep.capabilities.sharedStorageDriver ?? '—'}</span></div>
            <div className="kv">
              <b>multi-replica</b>
              <span className={`pill ${dep.capabilities.multiReplicaSafe ? 'ok' : 'gold'}`}>
                {dep.capabilities.multiReplicaSafe ? '✓' : '⚠'}
              </span>
            </div>
            {(dep.warnings ?? []).map((w) => (
              <p key={w} className="hint" style={{ color: 'var(--gold)' }}>⚠ {w}</p>
            ))}
          </div>
        ) : (
          <Skeleton count={3} width={90} />
        )}
      </details>
    </div>
  );
}

function Jump({ emoji, title, body, onClick }: { emoji: string; title: string; body: string; onClick: () => void }) {
  return (
    <button className="card" style={{ textAlign: 'right', cursor: 'pointer' }} onClick={onClick}>
      <div style={{ fontSize: 26 }}>{emoji}</div>
      <h3 style={{ marginTop: 8, marginBottom: 4, fontSize: 15 }}>{title}</h3>
      <p className="hint" style={{ margin: 0 }}>{body}</p>
    </button>
  );
}
