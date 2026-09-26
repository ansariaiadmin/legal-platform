'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type FileRecordView } from '@/lib/api';
import { t } from '@/i18n';

interface IngestionJob {
  jobId: string;
  sourceId: string;
  windowLabel: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial_success' | 'failed';
  attempted: number;
  succeeded: number;
  failed: number;
  documentIds: string[];
  rejectedIds: string[];
  startedAt: string;
  finishedAt: string | null;
  errorSummary: string | null;
  retryOf: string | null;
}

interface Stats {
  sources: number;
  documents: number;
  verified: number;
  retired: number;
  chunks: number;
  byTier: { official: number; vetted: number; general: number };
}

interface Doc {
  documentId: string;
  canonicalTitle: string;
  trustTier: 1 | 2 | 3;
  verifiedAt: string | null;
  ingestedAt: string;
  sha256: string;
}

interface Hit {
  documentId: string;
  canonicalTitle: string;
  trustTier: 1 | 2 | 3;
  verified: boolean;
  score: number;
  preview: string;
}

// Tier chips ride the existing pill palette — gold for official, teal for
// office-vetted, plain for general. The tier is metadata, and it shows.
const TIER: Record<1 | 2 | 3, { cls: string; label: string }> = {
  1: { cls: 'pill gold', label: '🏛 رسمی' },
  2: { cls: 'pill teal', label: '🗂 دفتر' },
  3: { cls: 'pill ok', label: '📚 عمومی' },
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.25)',
  border: '1px solid var(--line)',
  borderRadius: 10,
  padding: '11px 12px',
  fontSize: 14,
  width: '100%',
};

export function LibraryTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [files, setFiles] = useState<FileRecordView[]>([]);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  // P7 tour: "Paste the sample article" politely asks via CustomEvent —
  // the tour engine never pokes tab internals.
  useEffect(() => {
    const fill = () => setText(t('sample.law'));
    window.addEventListener('tour:try:library', fill);
    return () => window.removeEventListener('tour:try:library', fill);
  }, []);
  const [tier, setTier] = useState<1 | 2 | 3>(3);

  const refresh = useCallback(async () => {
    try {
      const f = await api
        .get<{ files: FileRecordView[] }>('/dashboard/orchestrator/files')
        .catch(() => ({ files: [] as FileRecordView[] }));
      setFiles(f.files);
      const s = await api.get<Stats>('/api/dashboard/corpus/stats');
      setStats(s);
      const d = await api.get<Doc[]>('/api/dashboard/corpus/documents');
      setDocs(d);
      const j = await api.get<IngestionJob[]>('/api/dashboard/corpus/jobs').catch(() => []);
      setJobs(j);
    } catch {
      /* the shelf may not be reachable yet; heartbeat keeps retrying per click */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function verify(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ verified: boolean; reasons?: string[] }>(
        `/api/dashboard/corpus/documents/${id}/verify`,
      );
      if (!r.verified) setMsg(`تأیید نشد: ${(r.reasons ?? []).join('؛ ')}`);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ingestText() {
    if (!title.trim() || text.trim().length < 50) {
      setMsg('عنوان و متن (دست‌کم ۵۰ نویسه) لازم است.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/api/dashboard/corpus/documents/ingest', {
        canonicalTitle: title.trim(),
        bodyRaw: text,
        trustTier: tier,
      });
      setTitle('');
      setText('');
      setMsg('سند به کتابخانه اضافه شد. برای استفاده در پاسخ‌ها باید آن را تأیید کنید.');
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ingestFile(fileId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ ingested: boolean; reason?: string }>(
        '/api/dashboard/corpus/documents/ingest-from-file',
        { fileId },
      );
      setMsg(r.ingested ? 'فایل به کتابخانه اضافه شد و منتظر تأیید است.' : `اضافه نشد: ${r.reason}`);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function search() {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    setHits(await api.get<Hit[]>(`/api/dashboard/corpus/search?q=${encodeURIComponent(query)}`));
  }

  async function syncNow() {
    setBusy(true);
    setMsg(null);
    try {
      const j = await api.post<IngestionJob>('/api/dashboard/corpus/sync', {});
      setMsg(
        j.status === 'succeeded'
          ? `همگام‌سازی کامل شد: ${j.succeeded} از ${j.attempted} سند اضافه شد.`
          : j.status === 'partial_success'
            ? `همگام‌سازی ناقص: ${j.succeeded} از ${j.attempted} سند اضافه شد و ${j.failed} مورد ناموفق بود.`
            : `همگام‌سازی ناموفق: ${j.errorSummary ?? 'علت نامشخص'}`,
      );
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function retryJob(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ retried: boolean; job?: IngestionJob }>(`/api/dashboard/corpus/jobs/${id}/retry`);
      setMsg(r.retried && r.job ? `دوباره اجرا شد: ${r.job.succeeded} از ${r.job.attempted}` : 'این کار پیدا نشد.');
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>

      {/* — shelf vitals — */}
      <div className="grid cols-3">
        <Tile stat={stats?.documents ?? '…'} sub="سند فعال" />
        <Tile stat={stats ? `${stats.verified}` : '…'} sub="✅ تأییدشده" />
        <Tile stat={stats?.chunks ?? '…'} sub="بخش نمایه‌شده" />
      </div>

      {stats && (
        <div className="card">
          <h3 style={{ margin: '0 0 10px' }}>سطح اعتبار منابع</h3>
          <div className="grid cols-3">
            <span className="pill gold" style={{ textAlign: 'center', padding: 10 }}>🏛 رسمی: {stats.byTier.official}</span>
            <span className="pill teal" style={{ textAlign: 'center', padding: 10 }}>🗂 تأییدشدهٔ دفتر: {stats.byTier.vetted}</span>
            <span className="pill ok" style={{ textAlign: 'center', padding: 10 }}>📚 عمومی: {stats.byTier.general}</span>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {stats.retired} نسخهٔ قدیمی در تاریخچه نگهداری می‌شود تا متن قانون در هر تاریخ قابل بازیابی باشد.
          </p>
        </div>
      )}

      {/* — collection & diagnostics (P2-T2/T5/T6) — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>همگام‌سازی با منابع</h3>
        <p className="hint">
          این دکمه فعلاً یک منبع نمونه را همگام می‌کند؛ اتصال به منابع رسمی در نسخه‌های بعد اضافه می‌شود.
          نتیجهٔ هر اجرا، حتی اگر ناقص باشد، دقیق گزارش می‌شود.
        </p>
        <button className="btn primary" disabled={busy} onClick={() => void syncNow()}>
          همگام‌سازی با منبع نمونه
        </button>
        {jobs.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {jobs.slice(0, 6).map((j) => (
              <div key={j.jobId} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
                <span className={`pill ${j.status === 'succeeded' ? 'ok' : j.status === 'partial_success' ? 'gold' : 'bad'}`}>
                  {j.status === 'succeeded' ? '✅ کامل'
                    : j.status === 'partial_success' ? '⚠️ ناقص'
                    : j.status === 'failed' ? '❌ ناموفق'
                    : '⏳'}
                </span>
                <div style={{ flex: 1, fontSize: 13 }}>
                  <b>{j.sourceId}</b> · بازهٔ {j.windowLabel} · {j.succeeded} از {j.attempted} اضافه شد
                  {j.failed > 0 && <span style={{ color: 'var(--rose)' }}> · {j.failed} ناموفق</span>}
                  {j.rejectedIds.length > 0 && <span style={{ color: 'var(--gold)' }}> · {j.rejectedIds.length} ردشده در بررسی</span>}
                  <div className="hint" style={{ marginTop: 2 }}>
                    {new Date(j.startedAt).toLocaleString('fa-IR')}{j.retryOf ? ' · اجرای دوباره' : ''}
                    {j.errorSummary ? ` · ${j.errorSummary}` : ''}
                  </div>
                </div>
                {(j.status === 'failed' || j.status === 'partial_success') && (
                  <button className="btn" style={{ padding: '6px 12px' }} disabled={busy} onClick={() => void retryJob(j.jobId)}>
                    تلاش دوباره
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* — deterministic search — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>جست‌وجو در کتابخانه</h3>
        <p className="hint">جست‌وجو فقط در منابع تأییدشده انجام می‌شود و برای هر پرسش یکسان، نتیجهٔ یکسان می‌دهد. دستیار هر منبعی را که به کار ببرد نام می‌برد.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="مثلاً: شرایط صحت معامله"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
          <button className="btn primary" onClick={() => void search()}>جست‌وجو</button>
        </div>
        {hits && (
          <div style={{ marginTop: 12 }}>
            {hits.length === 0 && <p className="hint">نتیجه‌ای در منابع تأییدشده پیدا نشد.</p>}
            {hits.map((h) => (
              <div key={h.documentId} style={{ padding: '10px 0', borderBottom: '1px dashed var(--line)' }}>
                <span className={TIER[h.trustTier].cls}>{TIER[h.trustTier].label}</span>{' '}
                <b>{h.canonicalTitle}</b>
                <small style={{ color: 'var(--text-dim)' }}> · امتیاز {h.score}</small>
                <div className="hint" style={{ marginTop: 6 }}>{h.preview}…</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* — shelf documents — */}
      <div className="card">
        <h3 style={{ margin: '0 0 10px' }}>اسناد کتابخانه</h3>
        {docs.length === 0 && <p className="hint">هنوز سندی اضافه نشده است. از بخش پایین متنی را بچسبانید یا از یک فایل شروع کنید.</p>}
        {docs.map((d) => (
          <div key={d.documentId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dashed var(--line)' }}>
            <span className={TIER[d.trustTier].cls}>{TIER[d.trustTier].label}</span>
            <div style={{ flex: 1 }}>
              <b>{d.canonicalTitle}</b>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                {d.verifiedAt
                  ? `✅ تأییدشده · ${new Date(d.verifiedAt).toLocaleDateString('fa-IR')}`
                  : '⏳ در انتظار تأیید'}
                {' '}· <code style={{ fontSize: 11 }}>{d.sha256.slice(0, 12)}</code>
              </div>
            </div>
            {!d.verifiedAt && (
              <button className="btn primary" disabled={busy} onClick={() => void verify(d.documentId)}>
                تأیید
              </button>
            )}
          </div>
        ))}
      </div>

      {/* — paste ingest — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>{t('library.ingest.paste')}</h3>
        <p className="hint">متن تکراری دوباره اضافه نمی‌شود. نسخهٔ جدید یک قانون جای نسخهٔ قبلی را می‌گیرد و نسخهٔ قبلی در تاریخچه می‌ماند.</p>
        <input style={inputStyle} placeholder="عنوان رسمی؛ مثلاً «قانون مدنی»" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          style={{ ...inputStyle, marginTop: 8, minHeight: 140, lineHeight: 1.9 }}
          placeholder="متن قانون…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select style={{ ...inputStyle, flex: 1 }} value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={3}>سطح ۳: عمومی</option>
            <option value={2}>سطح ۲: تأییدشدهٔ دفتر</option>
            <option value={1}>سطح ۱: رسمی</option>
          </select>
          <button className="btn primary" disabled={busy} onClick={() => void ingestText()}>افزودن</button>
        </div>
      </div>

      {/* — ingest-from-file — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>{t('library.ingest.file')}</h3>
        <p className="hint">فایل‌هایی که بارگذاری کرده‌اید می‌توانند مستقیم به منابع کتابخانه اضافه شوند؛ متن از خود فایل خوانده می‌شود، نه از هوش مصنوعی.</p>
        {files.length === 0 && <p className="hint">ابتدا در بخش «فایل‌ها» فایلی بارگذاری کنید.</p>}
        {files.map((f) => (
          <div key={f.fileId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
            <span style={{ fontSize: 13 }}>📄 {f.filename} <small style={{ color: 'var(--text-dim)' }}>({f.analysis?.chars ?? '?'} نویسه)</small></span>
            <button className="btn" style={{ padding: '8px 14px' }} disabled={busy} onClick={() => void ingestFile(f.fileId)}>افزودن به کتابخانه</button>
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

function Tile({ stat, sub }: { stat: string | number; sub: string }) {
  return (
    <div className="card" style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 30, fontWeight: 700 }}>{stat}</div>
      <div className="hint" style={{ marginTop: 6 }}>{sub}</div>
    </div>
  );
}
