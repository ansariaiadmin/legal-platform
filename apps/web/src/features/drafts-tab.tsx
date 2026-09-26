'use client';

import { useCallback, useEffect, useState } from 'react';
import { Num, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';
import { t } from '@/i18n';

interface Citation {
  documentId: string;
  title: string;
  trustTier: 1 | 2 | 3;
  preview: string;
  score: number;
}

interface Draft {
  draftId: string;
  state: 'created' | 'retrieving' | 'generating' | 'awaiting_review' | 'approved' | 'rejected' | 'superseded';
  prompt: string;
  output: string;
  provenance: { retrieved: Citation[]; model: string | null; usage: { totalTokens?: number } | null } | null;
  error: string | null;
  createdAt: string;
  supersedesId: string | null;
}

interface UsageMonth {
  month: string;
  totals: { requests: number; tokens: number; costUsd: number | null };
  features: Array<{ feature: string; model: string; requests: number; tokens: number; costUsd: number | null }>;
}

const STATE_PILL: Record<Draft['state'], { cls: string; label: string }> = {
  created: { cls: 'pill', label: '⏳ ثبت‌شده' },
  retrieving: { cls: 'pill teal', label: '🔍 یافتن منابع' },
  generating: { cls: 'pill teal', label: '✍️ در حال نگارش' },
  awaiting_review: { cls: 'pill gold', label: '👁 منتظر بازبینی' },
  approved: { cls: 'pill ok', label: '✅ تأییدشده' },
  rejected: { cls: 'pill bad', label: '❌ ردشده' },
  superseded: { cls: 'pill', label: '🔁 جایگزین‌شده' },
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '11px 12px',
  fontSize: 14,
  width: '100%',
};

export function DraftsTab() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [usage, setUsage] = useState<UsageMonth | null>(null);
  const [prompt, setPrompt] = useState('');
  useEffect(() => {
    const fill = () => setPrompt(t('sample.draftPrompt'));
    window.addEventListener('tour:try:drafts', fill);
    return () => window.removeEventListener('tour:try:drafts', fill);
  }, []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, u] = await Promise.all([
        api.get<Draft[]>('/dashboard/rag/drafts'),
        api.get<UsageMonth>('/dashboard/rag/usage/monthly').catch(() => null),
      ]);
      setDrafts(d);
      setUsage(u);
    } catch {
      /* first paint */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function makeDraft() {
    if (prompt.trim().length < 10) {
      setMsg('متن درخواست باید دست‌کم ۱۰ نویسه باشد.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const d = await api.post<Draft>('/dashboard/rag/drafts', { prompt: prompt.trim() });
      const g = await api.post<Draft>(`/dashboard/rag/drafts/${d.draftId}/generate`);
      setPrompt('');
      if (g.error === 'DRAFT_NO_CITATIONS') {
        setMsg('منبع تأییدشدهٔ مرتبطی پیدا نشد، بنابراین پیش‌نویسی نوشته نشد. ابتدا منبع مرتبط را به کتابخانه اضافه و تأیید کنید.');
      } else if (g.error) {
        setMsg(`خطا: ${g.error}`);
      } else {
        setMsg('پیش‌نویس آماده و منتظر بازبینی شماست.');
      }
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, action: 'approve' | 'reject' | 'supersede') {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/dashboard/rag/drafts/${id}/review`, { action });
      setMsg(action === 'approve' ? '✅ تأیید شد.' : action === 'reject' ? '❌ رد شد.' : '🔁 نسخهٔ جدید ساخته شد.');
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rebuildIndex() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ indexed: number; degraded: string | null }>('/dashboard/rag/index/rebuild');
      setMsg(r.degraded ? `نمایه‌سازی انجام نشد: ${r.degraded}` : `نمایه‌سازی انجام شد: ${r.indexed} بخش.`);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>

      {/* — usage — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>{t('drafts.usage')}</h3>
        {usage ? (
          <>
            <div className="grid cols-3" style={{ marginTop: 8 }}>
              <MiniV k="درخواست‌ها" v={<Num value={usage.totals.requests} />} />
              <MiniV k="توکن‌ها" v={<Num value={usage.totals.tokens} />} />
              <MiniV k="هزینهٔ تخمینی" v={usage.totals.costUsd === null ? 'قیمت تعریف نشده' : `$${usage.totals.costUsd.toFixed(4)}`} />
            </div>
            {usage.features.length > 0 && (
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-dim)' }}>
                {usage.features.map((f) => `${f.feature}/${f.model}: ${f.tokens} توکن`).join(' · ')}
              </div>
            )}
          </>
        ) : (
          // P10: skeleton over spinner — the shape previews the panel, so the
          // wait feels shorter and the layout never jumps when data lands.
          <div className="grid cols-3" style={{ marginTop: 8 }}>
            <Skeleton height={52} /><Skeleton height={52} /><Skeleton height={52} />
          </div>
        )}
        <button className="btn" style={{ marginTop: 12, padding: '8px 16px' }} disabled={busy} onClick={() => void rebuildIndex()}>
          بازسازی نمایهٔ جست‌وجوی معنایی (منابع تأییدشده)
        </button>
      </div>

      {/* — compose — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>{t('drafts.title')}</h3>
        <p className="hint">
          تا دست‌کم یک منبع تأییدشدهٔ مرتبط در کتابخانه نباشد، پیش‌نویسی نوشته نمی‌شود. هر پیش‌نویس فهرست منابع خود را در پایان دارد.
        </p>
        <textarea
          style={{ ...inputStyle, minHeight: 110 }}
          placeholder="درخواست خود را بنویسید؛ مثلاً: متن اظهارنامه برای مطالبهٔ اجاره‌بهای معوق"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn primary" disabled={busy} onClick={() => void makeDraft()}>نوشتن پیش‌نویس</button>
        </div>
      </div>

      {/* — list — */}
      <div className="card">
        <h3 style={{ margin: '0 0 10px' }}>پیش‌نویس‌ها</h3>
        {drafts.length === 0 && <p className="hint">هنوز پیش‌نویسی ثبت نشده است.</p>}
        {drafts.map((d) => (
          <div key={d.draftId} style={{ padding: '12px 0', borderBottom: '1px dashed var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className={STATE_PILL[d.state].cls}>{STATE_PILL[d.state].label}</span>
              <b style={{ flex: 1, fontSize: 14 }}>{d.prompt.slice(0, 80)}{d.prompt.length > 80 ? '…' : ''}</b>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {new Date(d.createdAt).toLocaleString('fa-IR')}
              {d.provenance?.model ? ` · مدل ${d.provenance.model}` : ''}
              {d.supersedesId ? ' · نسخهٔ اصلاح‌شدهٔ پیش‌نویس قبلی' : ''}
            </div>
            {d.error && <div style={{ marginTop: 6, color: 'var(--rose)', fontSize: 12 }}>خطا: {d.error}</div>}

            {d.state === 'awaiting_review' && (
              <>
                <div className="card" style={{ margin: '10px 0', background: 'rgba(0,0,0,0.25)', whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.9 }}>
                  {d.output}
                </div>
                {d.provenance && (
                  <div className="placement-card">
                    منابع استنادشده:
                    {d.provenance.retrieved.map((c, i) => (
                      <div key={c.documentId} style={{ marginTop: 4 }}>
                        [{i + 1}] «{c.title}»، سطح {c.trustTier}، امتیاز {c.score}
                        <div style={{ opacity: 0.8 }}>{c.preview}…</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <button className="btn primary" disabled={busy} onClick={() => void review(d.draftId, 'approve')}>تأیید</button>
                  <button className="btn" disabled={busy} onClick={() => void review(d.draftId, 'reject')}>رد</button>
                </div>
              </>
            )}
            {d.state === 'approved' && (
              <button className="btn" style={{ marginTop: 8, padding: '7px 14px' }} disabled={busy} onClick={() => void review(d.draftId, 'supersede')}>
                ساخت نسخهٔ جدید
              </button>
            )}
          </div>
        ))}
      </div>

      {msg && (
        <div className="card" style={{ borderColor: 'var(--gold)', background: 'rgba(244,200,93,0.06)' }}>
          <span>{msg}</span>
        </div>
      )}
    </div>
  );
}

function MiniV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: '10px 0' }}>
      <div style={{ fontSize: 20, fontWeight: 700 }}>{v}</div>
      <div className="hint" style={{ marginTop: 4 }}>{k}</div>
    </div>
  );
}
