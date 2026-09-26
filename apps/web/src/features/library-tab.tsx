'use client';

import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, Building2, Clock, FileText, Landmark, Library, RefreshCw, Search, Upload } from 'lucide-react';
import { api, ApiError, type FileRecordView } from '@/lib/api';
import { getPrefs, num, t, tx } from '@/i18n';

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

type Tier = 1 | 2 | 3;

function tierBadge(tier: Tier) {
  if (tier === 1) return { cls: 'pill gold', icon: <Landmark size={12} aria-hidden="true" />, label: tx('رسمی', 'Official') };
  if (tier === 2) return { cls: 'pill teal', icon: <Building2 size={12} aria-hidden="true" />, label: tx('تأییدشدهٔ دفتر', 'Office-vetted') };
  return { cls: 'pill', icon: <Library size={12} aria-hidden="true" />, label: tx('عمومی', 'General') };
}

function TierPill({ tier }: { tier: Tier }) {
  const b = tierBadge(tier);
  return (
    <span className={b.cls}>
      {b.icon}
      {b.label}
    </span>
  );
}

const dateFmt = (iso: string, withTime = false) =>
  new Date(iso)[withTime ? 'toLocaleString' : 'toLocaleDateString'](getPrefs().locale === 'fa' ? 'fa-IR' : 'en-GB');

function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : tx('خطای ناشناخته', 'Unknown error');
}

export function LibraryTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [files, setFiles] = useState<FileRecordView[]>([]);
  const [jobs, setJobs] = useState<IngestionJob[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [tier, setTier] = useState<Tier>(3);

  // Guided tour: "paste the sample article" arrives as an event.
  useEffect(() => {
    const fill = () => setText(t('sample.law'));
    window.addEventListener('tour:try:library', fill);
    return () => window.removeEventListener('tour:try:library', fill);
  }, []);

  const refresh = useCallback(async () => {
    const [f, s, d, j, diag] = await Promise.all([
      api.get<{ files: FileRecordView[] }>('/dashboard/orchestrator/files').catch(() => ({ files: [] as FileRecordView[] })),
      api.get<Stats>('/dashboard/corpus/stats').catch(() => null),
      api.get<Doc[]>('/dashboard/corpus/documents').catch(() => [] as Doc[]),
      api.get<IngestionJob[]>('/dashboard/corpus/jobs').catch(() => [] as IngestionJob[]),
      api.get<{ collectorSources?: string[] }>('/dashboard/corpus/diagnostics').catch(() => ({ collectorSources: [] })),
    ]);
    setFiles(f.files);
    setStats(s);
    setDocs(d);
    setJobs(j);
    setSources(diag.collectorSources ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(fn: () => Promise<{ ok: boolean; text: string } | null>) {
    setBusy(true);
    setMsg(null);
    try {
      const result = await fn();
      if (result) setMsg(result);
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const verify = (id: string) =>
    run(async () => {
      const r = await api.post<{ verified: boolean; reasons?: string[] }>(`/dashboard/corpus/documents/${id}/verify`);
      return r.verified
        ? { ok: true, text: tx('سند تأیید شد و از این پس در پاسخ‌ها قابل استناد است.', 'Document verified; answers can now cite it.') }
        : { ok: false, text: tx(`تأیید نشد: ${(r.reasons ?? []).join('؛ ')}`, `Not verified: ${(r.reasons ?? []).join('; ')}`) };
    });

  const ingestText = () =>
    run(async () => {
      if (!title.trim() || text.trim().length < 50) {
        return { ok: false, text: tx('عنوان و متن (دست‌کم ۵۰ نویسه) لازم است.', 'A title and at least 50 characters of text are required.') };
      }
      await api.post('/dashboard/corpus/documents/ingest', { canonicalTitle: title.trim(), bodyRaw: text, trustTier: tier });
      setTitle('');
      setText('');
      return {
        ok: true,
        text: tx('سند به کتابخانه اضافه شد. برای استفاده در پاسخ‌ها، آن را در فهرست اسناد تأیید کنید.', 'Document added. Verify it in the document list so answers can cite it.'),
      };
    });

  const ingestFile = (fileId: string) =>
    run(async () => {
      const r = await api.post<{ ingested: boolean; reason?: string }>('/dashboard/corpus/documents/ingest-from-file', { fileId });
      return r.ingested
        ? { ok: true, text: tx('فایل به کتابخانه اضافه شد و منتظر تأیید است.', 'File added to the library and awaiting verification.') }
        : { ok: false, text: tx(`اضافه نشد: ${r.reason ?? ''}`, `Not added: ${r.reason ?? ''}`) };
    });

  const syncNow = () =>
    run(async () => {
      const j = await api.post<IngestionJob>('/dashboard/corpus/sync', {});
      if (j.status === 'succeeded') {
        return { ok: true, text: tx(`همگام‌سازی کامل شد: ${num(j.succeeded)} از ${num(j.attempted)} سند اضافه شد.`, `Sync complete: ${num(j.succeeded)} of ${num(j.attempted)} documents added.`) };
      }
      if (j.status === 'partial_success') {
        return {
          ok: false,
          text: tx(
            `همگام‌سازی ناقص: ${num(j.succeeded)} از ${num(j.attempted)} سند اضافه شد و ${num(j.failed)} مورد ناموفق بود.`,
            `Partial sync: ${num(j.succeeded)} of ${num(j.attempted)} added, ${num(j.failed)} failed.`,
          ),
        };
      }
      return { ok: false, text: tx(`همگام‌سازی ناموفق: ${j.errorSummary ?? 'علت نامشخص'}`, `Sync failed: ${j.errorSummary ?? 'unknown reason'}`) };
    });

  const retryJob = (id: string) =>
    run(async () => {
      const r = await api.post<{ retried: boolean; job?: IngestionJob }>(`/dashboard/corpus/jobs/${id}/retry`);
      return r.retried && r.job
        ? { ok: true, text: tx(`دوباره اجرا شد: ${num(r.job.succeeded)} از ${num(r.job.attempted)}`, `Retried: ${num(r.job.succeeded)} of ${num(r.job.attempted)}`) }
        : { ok: false, text: tx('این اجرا پیدا نشد.', 'That run was not found.') };
    });

  async function search() {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    try {
      setHits(await api.get<Hit[]>(`/dashboard/corpus/search?q=${encodeURIComponent(query.trim())}`));
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid cols-3">
        <Tile stat={stats ? num(stats.documents) : '…'} sub={tx('سند فعال', 'Active documents')} />
        <Tile stat={stats ? num(stats.verified) : '…'} sub={tx('تأییدشده', 'Verified')} />
        <Tile stat={stats ? num(stats.chunks) : '…'} sub={tx('بخش نمایه‌شده برای جست‌وجو', 'Indexed passages')} />
      </div>

      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      {stats && (
        <div className="card">
          <h3>{tx('سطح اعتبار منابع', 'Source trust levels')}</h3>
          <div className="tier-row">
            <span className="pill gold"><Landmark size={13} aria-hidden="true" /> {tx('رسمی', 'Official')}: {num(stats.byTier.official)}</span>
            <span className="pill teal"><Building2 size={13} aria-hidden="true" /> {tx('تأییدشدهٔ دفتر', 'Office-vetted')}: {num(stats.byTier.vetted)}</span>
            <span className="pill"><Library size={13} aria-hidden="true" /> {tx('عمومی', 'General')}: {num(stats.byTier.general)}</span>
          </div>
          <p className="hint" style={{ margin: '10px 0 0' }}>
            {tx(
              `${num(stats.retired)} نسخهٔ قدیمی در تاریخچه نگهداری می‌شود تا متن قانون در هر تاریخ قابل بازیابی باشد.`,
              `${num(stats.retired)} earlier versions are kept so the text in force on any date can be retrieved.`,
            )}
          </p>
        </div>
      )}

      <div className="card">
        <h3 className="title-row"><Search size={18} aria-hidden="true" />{tx('جست‌وجو در کتابخانه', 'Search the library')}</h3>
        <p className="hint">
          {tx(
            'جست‌وجو فقط در منابع تأییدشده انجام می‌شود و برای پرسش یکسان نتیجهٔ یکسان می‌دهد. دستیار هر منبعی را که به کار ببرد نام می‌برد.',
            'Search covers verified sources only and returns the same result for the same query. The assistant names every source it uses.',
          )}
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <label className="sr-only" htmlFor="lib-q">{tx('عبارت جست‌وجو', 'Search terms')}</label>
          <input
            id="lib-q"
            className="text-input"
            placeholder={tx('مثلاً: شرایط صحت معامله', 'e.g. conditions for a valid contract')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="submit" className="btn primary">{tx('جست‌وجو', 'Search')}</button>
        </form>
        {hits && (
          <div className="list">
            {hits.length === 0 && <p className="empty-line">{tx('نتیجه‌ای در منابع تأییدشده پیدا نشد.', 'No match in verified sources.')}</p>}
            {hits.map((h) => (
              <div key={h.documentId} className="list-item">
                <div className="list-title">
                  <TierPill tier={h.trustTier} />
                  <b>{h.canonicalTitle}</b>
                  <small className="dim">{tx(`امتیاز ${num(h.score)}`, `score ${num(h.score)}`)}</small>
                </div>
                <p className="hint" style={{ margin: '6px 0 0' }}>{h.preview}…</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3>{tx('اسناد کتابخانه', 'Library documents')}</h3>
        {docs.length === 0 && (
          <p className="empty-line">
            {tx('هنوز سندی اضافه نشده است. از بخش پایین متن قانون را بچسبانید یا از یک فایل شروع کنید.', 'No documents yet. Paste a law text below or start from an uploaded file.')}
          </p>
        )}
        <div className="list">
          {docs.map((d) => (
            <div key={d.documentId} className="list-item row">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="list-title">
                  <TierPill tier={d.trustTier} />
                  <b>{d.canonicalTitle}</b>
                </div>
                <div className="list-meta">
                  {d.verifiedAt ? (
                    <span className="ok-text"><BadgeCheck size={13} aria-hidden="true" /> {tx('تأییدشده', 'Verified')} · {dateFmt(d.verifiedAt)}</span>
                  ) : (
                    <span className="warn-text"><Clock size={13} aria-hidden="true" /> {tx('در انتظار تأیید', 'Awaiting verification')}</span>
                  )}
                  <code dir="ltr" title="SHA-256">{d.sha256.slice(0, 12)}</code>
                </div>
              </div>
              {!d.verifiedAt && (
                <button className="btn primary small" disabled={busy} onClick={() => void verify(d.documentId)}>
                  <BadgeCheck size={15} aria-hidden="true" />
                  {tx('تأیید', 'Verify')}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3 className="title-row"><FileText size={18} aria-hidden="true" />{t('library.ingest.paste')}</h3>
        <p className="hint">
          {tx(
            'متن تکراری دوباره اضافه نمی‌شود. نسخهٔ جدید یک قانون جای نسخهٔ قبلی را می‌گیرد و نسخهٔ قبلی در تاریخچه می‌ماند.',
            'Duplicate text is not added twice. A new version of a law replaces the previous one, which stays in the history.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void ingestText();
          }}
        >
          <div className="field">
            <label htmlFor="lib-title">{tx('عنوان رسمی', 'Official title')}</label>
            <input id="lib-title" className="text-input" placeholder={tx('مثلاً: قانون مدنی', 'e.g. Civil Code')} value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lib-text">{tx('متن', 'Text')}</label>
            <textarea id="lib-text" className="text-input" rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </div>
          <div className="inline-form">
            <label className="sr-only" htmlFor="lib-tier">{tx('سطح اعتبار', 'Trust level')}</label>
            <select id="lib-tier" className="text-input" value={tier} onChange={(e) => setTier(Number(e.target.value) as Tier)}>
              <option value={3}>{tx('سطح ۳: عمومی', 'Level 3: general')}</option>
              <option value={2}>{tx('سطح ۲: تأییدشدهٔ دفتر', 'Level 2: office-vetted')}</option>
              <option value={1}>{tx('سطح ۱: رسمی', 'Level 1: official')}</option>
            </select>
            <button type="submit" className="btn primary" disabled={busy}>{tx('افزودن', 'Add')}</button>
          </div>
        </form>
      </div>

      <div className="card">
        <h3 className="title-row"><Upload size={18} aria-hidden="true" />{t('library.ingest.file')}</h3>
        <p className="hint">
          {tx(
            'فایل‌هایی که بارگذاری کرده‌اید می‌توانند مستقیم به کتابخانه اضافه شوند؛ متن از خود فایل خوانده می‌شود، نه از هوش مصنوعی.',
            'Uploaded files can be added to the library directly; the text is read from the file itself, not generated by AI.',
          )}
        </p>
        {files.length === 0 && <p className="empty-line">{tx('ابتدا در بخش «فایل‌ها» فایلی بارگذاری کنید.', 'Upload a file in the Files section first.')}</p>}
        <div className="list">
          {files.map((f) => (
            <div key={f.fileId} className="list-item row">
              <span className="list-title">
                <FileText size={15} aria-hidden="true" />
                <span>{f.filename}</span>
                <small className="dim">{tx(`${num(f.analysis?.chars ?? 0)} نویسه`, `${num(f.analysis?.chars ?? 0)} characters`)}</small>
              </span>
              <button className="btn small" disabled={busy} onClick={() => void ingestFile(f.fileId)}>
                {tx('افزودن به کتابخانه', 'Add to library')}
              </button>
            </div>
          ))}
        </div>
      </div>

      {sources.length > 0 && (
        <div className="card">
          <h3 className="title-row"><RefreshCw size={18} aria-hidden="true" />{tx('گردآوری خودکار', 'Automatic collection')}</h3>
          <p className="hint">
            {tx(
              'منابع گردآوری متصل: ',
              'Connected collection sources: ',
            )}
            <span dir="ltr">{sources.join(', ')}</span>
            {tx('. نتیجهٔ هر اجرا، حتی اگر ناقص باشد، دقیق گزارش می‌شود.', '. Every run is reported as it happened, including partial results.')}
          </p>
          <button className="btn primary" disabled={busy} onClick={() => void syncNow()}>
            {tx('همگام‌سازی اکنون', 'Sync now')}
          </button>
          {jobs.length > 0 && (
            <div className="list">
              {jobs.slice(0, 6).map((j) => (
                <div key={j.jobId} className="list-item row">
                  <span className={`pill ${j.status === 'succeeded' ? 'ok' : j.status === 'partial_success' ? 'gold' : j.status === 'failed' ? 'bad' : ''}`}>
                    {j.status === 'succeeded'
                      ? tx('کامل', 'Complete')
                      : j.status === 'partial_success'
                        ? tx('ناقص', 'Partial')
                        : j.status === 'failed'
                          ? tx('ناموفق', 'Failed')
                          : tx('در حال اجرا', 'Running')}
                  </span>
                  <div style={{ flex: 1, fontSize: 13 }}>
                    <b dir="ltr">{j.sourceId}</b> · {j.windowLabel} ·{' '}
                    {tx(`${num(j.succeeded)} از ${num(j.attempted)} اضافه شد`, `${num(j.succeeded)} of ${num(j.attempted)} added`)}
                    {j.failed > 0 && <span className="bad-text"> · {tx(`${num(j.failed)} ناموفق`, `${num(j.failed)} failed`)}</span>}
                    {j.rejectedIds.length > 0 && (
                      <span className="warn-text"> · {tx(`${num(j.rejectedIds.length)} رد در بررسی`, `${num(j.rejectedIds.length)} rejected by checks`)}</span>
                    )}
                    <div className="list-meta">
                      {dateFmt(j.startedAt, true)}
                      {j.retryOf ? tx(' · اجرای دوباره', ' · retry') : ''}
                      {j.errorSummary ? ` · ${j.errorSummary}` : ''}
                    </div>
                  </div>
                  {(j.status === 'failed' || j.status === 'partial_success') && (
                    <button className="btn small" disabled={busy} onClick={() => void retryJob(j.jobId)}>
                      {tx('تلاش دوباره', 'Retry')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tile({ stat, sub }: { stat: string; sub: string }) {
  return (
    <div className="card stat-tile">
      <div className="stat-figure">{stat}</div>
      <div className="hint">{sub}</div>
    </div>
  );
}
