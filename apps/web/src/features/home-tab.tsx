'use client';

import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, Cpu, FolderOpen, MessagesSquare, PlugZap, Users, type LucideIcon } from 'lucide-react';
import { t, type TranslationKey } from '@/i18n';
import { api, type BrainView } from '@/lib/api';
import { Kpi, Skeleton } from '@/components/ui';

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

  const hasLocal = Boolean(brain?.local.baseUrl);
  const hasCloud = Boolean(brain?.cloud.apiKeyMasked);
  const brainOn = hasLocal || hasCloud;
  const modelKey: TranslationKey = hasLocal && hasCloud ? 'home.model.both' : hasCloud ? 'home.model.cloud' : hasLocal ? 'home.model.local' : 'home.model.none';
  const policyKey = `home.policy.${brain?.effectivePolicy ?? ''}`;

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div className="bento">
        <div className="card span-3" style={{ padding: 26 }}>
          <p className="hint" style={{ margin: '0 0 4px' }}>{t(greetingKey())}</p>
          <h2 style={{ marginTop: 0 }}>{t('home.title')}</h2>
          <p className="hint" style={{ maxWidth: 560 }}>
            {brain ? t(modelKey) : <Skeleton count={2} width={70} />}
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <span className="pill gold">{t('home.preset')}: {t(TIER_KEY[brain?.preset ?? 'spartan'] ?? 'brain.tier.spartan')}</span>
            {brain && (
              <span className="pill teal">
                {t('home.policy')}: {t(policyKey as TranslationKey) === policyKey ? brain.effectivePolicy : t(policyKey as TranslationKey)}
              </span>
            )}
          </div>
        </div>

        <Kpi
          label={t('home.kpi.brain')}
          figure={brainOn ? <Cpu size={30} aria-hidden="true" /> : <PlugZap size={30} aria-hidden="true" />}
          sub={brainOn ? t('home.kpi.brain.on') : t('home.kpi.brain.off')}
          tone={brainOn ? 'ok' : 'bad'}
        />

        <Jump icon={MessagesSquare} title={t('tab.chat')} body={t('home.jump.chat')} onClick={() => goTab('chat')} />
        <Jump icon={Cpu} title={t('tab.brain')} body={t('home.jump.brain')} onClick={() => goTab('brain')} />
        <Jump icon={Activity} title={t('tab.kitchen')} body={t('home.jump.kitchen')} onClick={() => goTab('kitchen')} />
        <Jump icon={Users} title={t('tab.fleet')} body={t('home.jump.fleet')} onClick={() => goTab('fleet')} />
        <Jump icon={FolderOpen} title={t('tab.files')} body={t('home.jump.files')} onClick={() => goTab('files')} />
      </div>

      <details className="reveal">
        <summary>{t('home.system.details')}</summary>
        {dep ? (
          <div>
            <div className="kv"><b>{t('home.kpi.deployment')}</b><span className="ltr bidi">{dep.mode}</span></div>
            <div className="kv"><b>{t('home.sys.rateLimiter')}</b><span className="ltr bidi">{dep.capabilities.rateLimiterDriver ?? '—'}</span></div>
            <div className="kv"><b>{t('home.sys.storage')}</b><span className="ltr bidi">{dep.capabilities.sharedStorageDriver ?? '—'}</span></div>
            <div className="kv">
              <b>{t('home.sys.multiReplica')}</b>
              <span className={`pill ${dep.capabilities.multiReplicaSafe ? 'ok' : 'gold'}`}>
                {dep.capabilities.multiReplicaSafe ? t('home.sys.yes') : t('home.sys.no')}
              </span>
            </div>
            {(dep.warnings ?? []).map((w) => (
              <p key={w} className="hint warn-line"><AlertTriangle size={14} aria-hidden="true" /> {w}</p>
            ))}
          </div>
        ) : (
          <Skeleton count={3} width={90} />
        )}
      </details>
    </div>
  );
}

function Jump({ icon: Icon, title, body, onClick }: { icon: LucideIcon; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" className="card jump-card" onClick={onClick}>
      <span className="jump-icon"><Icon size={20} aria-hidden="true" /></span>
      <h3>{title}</h3>
      <p className="hint">{body}</p>
    </button>
  );
}
