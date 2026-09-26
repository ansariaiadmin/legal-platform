'use client';

import { useState } from 'react';
import { Cloud, Server } from 'lucide-react';
import { t, tx, num, type TranslationKey } from '@/i18n';
import { api, ApiError, type BrainView } from '@/lib/api';

type Tier = 'spartan' | 'counsel' | 'senator';
const TIERS: Tier[] = ['spartan', 'counsel', 'senator'];

export function BrainTab({ brain, onChanged }: { brain: BrainView | null; onChanged: () => Promise<void> }) {
  const hasLocal = Boolean(brain?.local.baseUrl);
  const hasCloud = Boolean(brain?.cloud.apiKeyMasked);
  const modelKey: TranslationKey = hasLocal && hasCloud ? 'home.model.both' : hasCloud ? 'home.model.cloud' : hasLocal ? 'home.model.local' : 'home.model.none';

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid cols-2">
        <Connector kind="local" onChanged={onChanged} />
        <Connector kind="cloud" onChanged={onChanged} />
      </div>

      <div className="card">
        <h3>{tx('پیش‌تنظیم کیفیت و هزینه', 'Quality and cost preset')}</h3>
        <p className="hint">
          {tx(
            'تعیین می‌کند پاسخ‌ها اول از مدل محلی تولید شوند یا از سرویس ابری. هر زمان قابل تغییر است.',
            'Decides whether answers come from the local model or the cloud service first. You can change it at any time.',
          )}
        </p>
        <div className="grid cols-3">
          {TIERS.map((tier) => (
            <TierCard key={tier} tier={tier} active={brain?.preset === tier} onChanged={onChanged} />
          ))}
        </div>
      </div>

      {brain && (
        <div className="card">
          <h3>{tx('وضعیت فعلی', 'Current status')}</h3>
          <div className="kv">
            <b>{t('brain.local')}</b>
            <span dir="ltr">{brain.local.baseUrl ?? '—'} {brain.local.model ? `(${brain.local.model})` : ''}</span>
          </div>
          <div className="kv"><b>{tx('منبع تنظیم محلی', 'Local setting source')}</b><span>{t(`brain.source.${brain.local.source}` as TranslationKey)}</span></div>
          <div className="kv">
            <b>{t('brain.cloud')}</b>
            <span dir="ltr">{brain.cloud.apiKeyMasked ?? '—'} {brain.cloud.model ? `(${brain.cloud.model})` : ''}</span>
          </div>
          <div className="kv"><b>{tx('منبع تنظیم ابری', 'Cloud setting source')}</b><span>{t(`brain.source.${brain.cloud.source}` as TranslationKey)}</span></div>
          <div className="kv"><b>{tx('خلاصه', 'Summary')}</b><span>{t(modelKey)}</span></div>
        </div>
      )}

      <p className="hint" style={{ textAlign: 'center' }}>{t('brain.ask_leader')}</p>
    </div>
  );
}

function Connector({ kind, onChanged }: { kind: 'local' | 'cloud'; onChanged: () => Promise<void> }) {
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs?: number; error?: string }>('/dashboard/config/brain/test', {
        target: kind,
        baseUrl: baseUrl || undefined,
        apiKey: apiKey || undefined,
      });
      setStatus(
        r.ok
          ? { ok: true, text: tx(`اتصال برقرار شد (${num(r.latencyMs ?? 0)} میلی‌ثانیه).`, `Connected (${num(r.latencyMs ?? 0)} ms).`) }
          : { ok: false, text: tx(`اتصال برقرار نشد: ${r.error ?? 'علت نامشخص'}`, `Could not connect: ${r.error ?? 'unknown reason'}`) },
      );
    } catch (e) {
      setStatus({ ok: false, text: e instanceof ApiError ? e.message : tx('آزمایش اتصال انجام نشد.', 'The connection test did not run.') });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await api.post('/dashboard/config/brain', {
        target: kind,
        baseUrl: baseUrl || undefined,
        model: model || undefined,
        apiKey: apiKey || undefined,
      });
      setStatus({ ok: true, text: tx('ذخیره شد و از همین حالا استفاده می‌شود.', 'Saved and in use from now on.') });
      setApiKey('');
      await onChanged();
    } catch (e) {
      setStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  const isLocal = kind === 'local';
  const id = (name: string) => `brain-${kind}-${name}`;
  return (
    <form
      className="card"
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && baseUrl && (isLocal || apiKey)) void save();
      }}
    >
      <h3 className="title-row">
        {isLocal ? <Server size={18} aria-hidden="true" /> : <Cloud size={18} aria-hidden="true" />}
        {isLocal ? t('brain.local') : t('brain.cloud')}
      </h3>
      <p className="hint">{isLocal ? t('brain.local.hint') : t('brain.cloud.hint')}</p>
      <div className="field">
        <label htmlFor={id('url')}>{t('brain.baseUrl')}</label>
        <input id={id('url')} dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={isLocal ? 'http://SERVER-IP:11434/v1' : 'https://api.openai.com/v1'} />
      </div>
      <div className="field">
        <label htmlFor={id('model')}>{t('brain.model')}</label>
        <input id={id('model')} dir="ltr" value={model} onChange={(e) => setModel(e.target.value)} placeholder={isLocal ? 'qwen2.5:14b-instruct' : 'gpt-5-mini'} />
      </div>
      {!isLocal && (
        <div className="field">
          <label htmlFor={id('key')}>{t('brain.apiKey')}</label>
          <input id={id('key')} dir="ltr" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </div>
      )}
      {status && (
        <p className={status.ok ? 'form-ok' : 'form-error'} role={status.ok ? 'status' : 'alert'} style={{ marginBottom: 0 }}>
          {status.text}
        </p>
      )}
      <div className="row-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn" disabled={busy || !baseUrl} onClick={() => void test()}>{t('brain.test')}</button>
        <button type="submit" className="btn primary" disabled={busy || (!isLocal && !apiKey) || !baseUrl}>{t('brain.save')}</button>
      </div>
    </form>
  );
}

function TierCard({ tier, active, onChanged }: { tier: Tier; active: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`choice tier-card ${active ? 'active' : ''}`}
      aria-pressed={active}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/dashboard/config/preset', { preset: tier });
          await onChanged();
        } catch {
          /* the active state simply does not change */
        } finally {
          setBusy(false);
        }
      }}
    >
      <b className="title-row">
        {t(`brain.tier.${tier}` as TranslationKey)}
        {active && <span className="pill gold">{tx('فعال', 'Active')}</span>}
      </b>
      <small>{t(`brain.tier.${tier}.hint` as TranslationKey)}</small>
    </button>
  );
}
