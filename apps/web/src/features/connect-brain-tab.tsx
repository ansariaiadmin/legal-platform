'use client';

import { useState } from 'react';
import { t } from '@/i18n';
import { api, type BrainView } from '@/lib/api';

const TIERS = [
  { id: 'spartan', emoji: '🟢', title: t('brain.tier.spartan'), hint: t('brain.tier.spartan.hint') },
  { id: 'counsel', emoji: '🟡', title: t('brain.tier.counsel'), hint: t('brain.tier.counsel.hint') },
  { id: 'senator', emoji: '🔴', title: t('brain.tier.senator'), hint: t('brain.tier.senator.hint') },
] as const;

export function BrainTab({ brain, onChanged }: { brain: BrainView | null; onChanged: () => Promise<void> }) {
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid cols-2">
        <Connector kind="local" onChanged={onChanged} />
        <Connector kind="cloud" onChanged={onChanged} />
      </div>

      <div className="card">
        <h3>تیر ناوگان — یک لمس</h3>
        <p className="hint">سه حالت آماده؛ بقیه‌اش را لیدر مدیریت می‌کند (گرنت‌ها، قرضِ مدل، سیاست).</p>
        <div className="grid cols-3">
          {TIERS.map((tier) => (
            <TierCard key={tier.id} tier={tier} active={brain?.preset === tier.id} onChanged={onChanged} />
          ))}
        </div>
      </div>

      {brain && (
        <div className="card">
          <h3>وضعیت فعلی مغز</h3>
          <div className="kv"><b>محلی</b><span className="ltr">{brain.local.baseUrl ?? '—'} {brain.local.model ? `(${brain.local.model})` : ''}</span></div>
          <div className="kv"><b>منشا محلی</b><span>{t(`brain.source.${brain.local.source}` as never)}</span></div>
          <div className="kv"><b>ابری</b><span className="ltr">{brain.cloud.apiKeyMasked ?? '—'} {brain.cloud.model ? `(${brain.cloud.model})` : ''}</span></div>
          <div className="kv"><b>منشا ابری</b><span>{t(`brain.source.${brain.cloud.source}` as never)}</span></div>
          <div className="kv"><b>سناریوی قرض</b><span>{brain.lendingScenario}</span></div>
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
  const [status, setStatus] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true); setStatus(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs?: number; error?: string }>(
        '/dashboard/config/brain/test',
        { target: kind, baseUrl: baseUrl || undefined, apiKey: apiKey || undefined },
      );
      setStatus(r.ok
        ? { tone: 'ok', text: `وصل شد ✅ (${r.latencyMs}ms)` }
        : { tone: 'bad', text: `وصل نشد: ${r.error ?? 'نامشخص'}` });
    } catch {
      setStatus({ tone: 'bad', text: 'خطا در درخواست تست' });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true); setStatus(null);
    try {
      await api.post('/dashboard/config/brain', {
        target: kind,
        baseUrl: baseUrl || undefined,
        model: model || undefined,
        apiKey: apiKey || undefined,
      });
      setStatus({ tone: 'ok', text: 'ذخیره شد — مغز از همین حالا فعال است 🎉' });
      await onChanged();
    } catch (e) {
      setStatus({ tone: 'bad', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const isLocal = kind === 'local';
  return (
    <div className="card">
      <h3>{isLocal ? `🏠 ${t('brain.local')}` : `☁️ ${t('brain.cloud')}`}</h3>
      <p className="hint">{isLocal ? t('brain.local.hint') : t('brain.cloud.hint')}</p>
      <div className="field">
        <label>{t('brain.baseUrl')}</label>
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={isLocal ? 'http://gpu-box:8080' : 'https://api.openai.com'} />
      </div>
      <div className="field">
        <label>{t('brain.model')}</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={isLocal ? 'qwen2.5:14b-instruct' : 'gpt-5-mini'} />
      </div>
      {!isLocal && (
        <div className="field">
          <label>{t('brain.apiKey')}</label>
          <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-…" />
        </div>
      )}
      {status && <p className={`pill ${status.tone === 'ok' ? 'ok' : 'bad'}`}>{status.text}</p>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button className="btn" disabled={busy || !baseUrl} onClick={test}>{t('brain.test')}</button>
        <button className="btn primary" disabled={busy || (!isLocal && !apiKey) || !baseUrl} onClick={save}>{t('brain.save')}</button>
      </div>
    </div>
  );
}

function TierCard({ tier, active, onChanged }: { tier: { id: string; emoji: string; title: string; hint: string }; active: boolean; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="card"
      style={{
        textAlign: 'right',
        cursor: 'pointer',
        border: active ? '2px solid var(--gold)' : undefined,
        opacity: busy ? 0.6 : 1,
      }}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api.post('/dashboard/config/preset', { preset: tier.id });
          await onChanged();
        } finally {
          setBusy(false);
        }
      }}
    >
      <div style={{ fontSize: 26 }}>{tier.emoji}</div>
      <h3 style={{ marginTop: 6 }}>{tier.title} {active && <span className="pill gold">فعال</span>}</h3>
      <p className="hint">{tier.hint}</p>
    </button>
  );
}
