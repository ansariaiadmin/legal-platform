'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, FilePlus2, RefreshCw, X } from 'lucide-react';
import { RichText } from '@/components/rich-text';
import { Num, Skeleton } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { getPrefs, num, t, tx } from '@/i18n';

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

function statePill(state: Draft['state']): { cls: string; label: string } {
  switch (state) {
    case 'created':
      return { cls: 'pill', label: tx('ثبت‌شده', 'Created') };
    case 'retrieving':
      return { cls: 'pill teal', label: tx('در حال یافتن منابع', 'Finding sources') };
    case 'generating':
      return { cls: 'pill teal', label: tx('در حال نگارش', 'Writing') };
    case 'awaiting_review':
      return { cls: 'pill gold', label: tx('منتظر بازبینی', 'Awaiting review') };
    case 'approved':
      return { cls: 'pill ok', label: tx('تأییدشده', 'Approved') };
    case 'rejected':
      return { cls: 'pill bad', label: tx('ردشده', 'Rejected') };
    case 'superseded':
      return { cls: 'pill', label: tx('جایگزین‌شده', 'Superseded') };
  }
}

function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : tx('خطای ناشناخته', 'Unknown error');
}

export function DraftsTab() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [usage, setUsage] = useState<UsageMonth | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const fill = () => setPrompt(t('sample.draftPrompt'));
    window.addEventListener('tour:try:drafts', fill);
    return () => window.removeEventListener('tour:try:drafts', fill);
  }, []);

  const refresh = useCallback(async () => {
    const [d, u] = await Promise.all([
      api.get<Draft[]>('/dashboard/rag/drafts').catch(() => null),
      api.get<UsageMonth>('/dashboard/rag/usage/monthly').catch(() => null),
    ]);
    if (d) setDrafts(d);
    setUsage(u);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<{ ok: boolean; text: string }>) {
    setBusy(true);
    setMsg(null);
    try {
      setMsg(await fn());
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const makeDraft = () =>
    run(async () => {
      if (prompt.trim().length < 10) {
        return { ok: false, text: tx('متن درخواست باید دست‌کم ۱۰ نویسه باشد.', 'The request must be at least 10 characters.') };
      }
      const d = await api.post<Draft>('/dashboard/rag/drafts', { prompt: prompt.trim() });
      const g = await api.post<Draft>(`/dashboard/rag/drafts/${d.draftId}/generate`);
      setPrompt('');
      if (g.error === 'DRAFT_NO_CITATIONS') {
        return {
          ok: false,
          text: tx(
            'منبع تأییدشدهٔ مرتبطی پیدا نشد، بنابراین پیش‌نویسی نوشته نشد. ابتدا منبع مرتبط را به کتابخانه اضافه و تأیید کنید.',
            'No relevant verified source was found, so no draft was written. Add and verify a relevant source in the library first.',
          ),
        };
      }
      if (g.error) return { ok: false, text: tx(`خطا: ${g.error}`, `Error: ${g.error}`) };
      return { ok: true, text: tx('پیش‌نویس آماده و منتظر بازبینی شماست.', 'The draft is ready for your review.') };
    });

  const review = (id: string, action: 'approve' | 'reject' | 'supersede') =>
    run(async () => {
      await api.post(`/dashboard/rag/drafts/${id}/review`, { action });
      return {
        ok: true,
        text:
          action === 'approve'
            ? tx('پیش‌نویس تأیید شد.', 'Draft approved.')
            : action === 'reject'
              ? tx('پیش‌نویس رد شد.', 'Draft rejected.')
              : tx('نسخهٔ جدید ساخته شد و منتظر بازبینی است.', 'A new version was created for review.'),
      };
    });

  const rebuildIndex = () =>
    run(async () => {
      const r = await api.post<{ indexed: number; degraded: string | null }>('/dashboard/rag/index/rebuild');
      return r.degraded
        ? { ok: false, text: tx(`نمایه‌سازی انجام نشد: ${r.degraded}`, `Indexing did not run: ${r.degraded}`) }
        : { ok: true, text: tx(`نمایه‌سازی انجام شد: ${num(r.indexed)} بخش.`, `Indexed ${num(r.indexed)} passages.`) };
    });

  async function copy(d: Draft) {
    try {
      await navigator.clipboard.writeText(d.output);
      setCopied(d.draftId);
      setTimeout(() => setCopied((c) => (c === d.draftId ? null : c)), 2000);
    } catch {
      setMsg({ ok: false, text: tx('کپی انجام نشد؛ متن را دستی انتخاب کنید.', 'Copy failed; select the text manually.') });
    }
  }

  const locale = getPrefs().locale === 'fa' ? 'fa-IR' : 'en-GB';

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card">
        <h3 className="title-row"><FilePlus2 size={18} aria-hidden="true" />{t('drafts.title')}</h3>
        <p className="hint">
          {tx(
            'تا دست‌کم یک منبع تأییدشدهٔ مرتبط در کتابخانه نباشد، پیش‌نویسی نوشته نمی‌شود. هر پیش‌نویس فهرست منابع خود را دارد و پیش از استفاده باید بازبینی شود.',
            'No draft is written unless at least one relevant verified source is in the library. Every draft lists its sources and must be reviewed before use.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void makeDraft();
          }}
        >
          <label className="sr-only" htmlFor="draft-prompt">{tx('درخواست', 'Request')}</label>
          <textarea
            id="draft-prompt"
            className="text-input"
            rows={4}
            placeholder={tx('مثلاً: متن اظهارنامه برای مطالبهٔ اجاره‌بهای معوق', 'e.g. a formal notice demanding overdue rent')}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button type="submit" className="btn primary" style={{ marginTop: 10 }} disabled={busy}>
            {busy ? tx('در حال نگارش…', 'Writing…') : tx('نوشتن پیش‌نویس', 'Write draft')}
          </button>
        </form>
      </div>

      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      <div className="card">
        <h3>{tx('پیش‌نویس‌ها', 'Drafts')}</h3>
        {drafts.length === 0 && <p className="empty-line">{tx('هنوز پیش‌نویسی ثبت نشده است.', 'No drafts yet.')}</p>}
        <div className="list">
          {drafts.map((d) => {
            const pill = statePill(d.state);
            const showOutput = (d.state === 'awaiting_review' || d.state === 'approved') && d.output;
            return (
              <div key={d.draftId} className="list-item">
                <div className="list-title">
                  <span className={pill.cls}>{pill.label}</span>
                  <b style={{ flex: 1, fontSize: 14 }}>
                    {d.prompt.slice(0, 100)}
                    {d.prompt.length > 100 ? '…' : ''}
                  </b>
                </div>
                <div className="list-meta">
                  {new Date(d.createdAt).toLocaleString(locale)}
                  {d.provenance?.model ? <span dir="ltr">{d.provenance.model}</span> : null}
                  {d.supersedesId ? tx('نسخهٔ اصلاح‌شدهٔ پیش‌نویس قبلی', 'revision of an earlier draft') : null}
                </div>
                {d.error && <p className="form-error" style={{ marginTop: 8 }}>{tx(`خطا: ${d.error}`, `Error: ${d.error}`)}</p>}

                {showOutput && (
                  <>
                    <div className="draft-output"><RichText text={d.output} /></div>
                    {d.provenance && d.provenance.retrieved.length > 0 && (
                      <div className="placement-card">
                        <b>{tx('منابع استنادشده', 'Cited sources')}</b>
                        {d.provenance.retrieved.map((c, i) => (
                          <div key={c.documentId} style={{ marginTop: 6 }}>
                            [{num(i + 1)}] «{c.title}» · {tx(`سطح ${num(c.trustTier)}`, `level ${num(c.trustTier)}`)}
                            <div style={{ opacity: 0.8 }}>{c.preview}…</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="row-actions" style={{ marginTop: 10 }}>
                      {d.state === 'awaiting_review' && (
                        <>
                          <button className="btn primary small" disabled={busy} onClick={() => void review(d.draftId, 'approve')}>
                            <Check size={15} aria-hidden="true" />
                            {tx('تأیید', 'Approve')}
                          </button>
                          <button className="btn small" disabled={busy} onClick={() => void review(d.draftId, 'reject')}>
                            <X size={15} aria-hidden="true" />
                            {tx('رد', 'Reject')}
                          </button>
                        </>
                      )}
                      <button className="btn ghost small" onClick={() => void copy(d)}>
                        <Copy size={15} aria-hidden="true" />
                        {copied === d.draftId ? tx('کپی شد', 'Copied') : tx('کپی متن', 'Copy text')}
                      </button>
                      {d.state === 'approved' && (
                        <button className="btn ghost small" disabled={busy} onClick={() => void review(d.draftId, 'supersede')}>
                          {tx('ساخت نسخهٔ جدید', 'New version')}
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h3>{t('drafts.usage')}</h3>
        {usage ? (
          <>
            <div className="grid cols-3" style={{ marginTop: 8 }}>
              <MiniV k={tx('درخواست‌ها', 'Requests')} v={<Num value={usage.totals.requests} />} />
              <MiniV k={tx('توکن‌ها', 'Tokens')} v={<Num value={usage.totals.tokens} />} />
              <MiniV
                k={tx('هزینهٔ تخمینی', 'Estimated cost')}
                v={usage.totals.costUsd === null ? tx('قیمت تعریف نشده', 'No price set') : <span dir="ltr">${usage.totals.costUsd.toFixed(4)}</span>}
              />
            </div>
            {usage.features.length > 0 && (
              <p className="hint" style={{ marginTop: 10 }}>
                {usage.features.map((f) => `${f.feature} / ${f.model}: ${num(f.tokens)} ${tx('توکن', 'tokens')}`).join(' · ')}
              </p>
            )}
          </>
        ) : (
          <div className="grid cols-3" style={{ marginTop: 8 }}>
            <Skeleton height={52} />
            <Skeleton height={52} />
            <Skeleton height={52} />
          </div>
        )}
        <button className="btn small" style={{ marginTop: 12 }} disabled={busy} onClick={() => void rebuildIndex()}>
          <RefreshCw size={15} aria-hidden="true" />
          {tx('بازسازی نمایهٔ جست‌وجوی معنایی', 'Rebuild the semantic search index')}
        </button>
      </div>
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
