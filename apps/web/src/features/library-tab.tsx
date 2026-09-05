'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type FileRecordView } from '@/lib/api';

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
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
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
      if (!r.verified) setMsg(`اعتبارسنجی رد شد: ${(r.reasons ?? []).join(' — ')}`);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function ingestText() {
    if (!title.trim() || text.trim().length < 50) {
      setMsg('عنوان و متن (حداقل ۵۰ نویسه) لازم است.');
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
      setMsg('سند روی قفسه نشست؛ برای ورود به پاسخ‌ها لازم است تیک اعتبارسنجی بگیرد.');
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
      setMsg(r.ingested ? 'فایل به کتابخانه پیوست — در انتظار تیک اعتبارسنجی.' : `رد شد: ${r.reason}`);
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

  return (
    <div className="grid" style={{ gap: 18 }}>

      {/* — shelf vitals — */}
      <div className="grid cols-3">
        <Tile stat={stats?.documents ?? '…'} sub="سند فعال" />
        <Tile stat={stats ? `${stats.verified}` : '…'} sub="✅ تأییدشده" />
        <Tile stat={stats?.chunks ?? '…'} sub="تکهٔ ترکیبی" />
      </div>

      {stats && (
        <div className="card">
          <h3 style={{ margin: '0 0 10px' }}>اعتمادِ قفسه</h3>
          <div className="grid cols-3">
            <span className="pill gold" style={{ textAlign: 'center', padding: 10 }}>🏛 رسمی — {stats.byTier.official}</span>
            <span className="pill teal" style={{ textAlign: 'center', padding: 10 }}>🗂 تأییدشدهٔ دفتر — {stats.byTier.vetted}</span>
            <span className="pill ok" style={{ textAlign: 'center', padding: 10 }}>📚 عمومی — {stats.byTier.general}</span>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            {stats.retired} نسخهٔ بازنشسته در تاریخچه مانده‌اند — «قانون در روز فلان» هرگز از جیت پاک نمی‌شود.
          </p>
        </div>
      )}

      {/* — deterministic search — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>جستجوی قطعی در کتابخانه</h3>
        <p className="hint">همان موتور همان نتیجه را دوباره برمی‌گرداند — وقتی لیدر از منبعی استفاده کند، نامش را هم می‌فرستد.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="مثلاً: شرایط عقد قرارداد ملک"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void search()}
          />
          <button className="btn primary" onClick={() => void search()}>جستجو</button>
        </div>
        {hits && (
          <div style={{ marginTop: 12 }}>
            {hits.length === 0 && <p className="hint">چیزی در قفسهٔ تأییدشده نیست.</p>}
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
        <h3 style={{ margin: '0 0 10px' }}>اسناد روی قفسه</h3>
        {docs.length === 0 && <p className="hint">هنوز سندی نیست — پایین یک متن بچسبان یا از یک فایل شروع کن.</p>}
        {docs.map((d) => (
          <div key={d.documentId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px dashed var(--line)' }}>
            <span className={TIER[d.trustTier].cls}>{TIER[d.trustTier].label}</span>
            <div style={{ flex: 1 }}>
              <b>{d.canonicalTitle}</b>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
                {d.verifiedAt
                  ? `✅ تأییدشده · ${new Date(d.verifiedAt).toLocaleDateString('fa-IR')}`
                  : '⏳ در انتظار اعتبارسنجی'}
                {' '}· <code style={{ fontSize: 11 }}>{d.sha256.slice(0, 12)}</code>
              </div>
            </div>
            {!d.verifiedAt && (
              <button className="btn primary" disabled={busy} onClick={() => void verify(d.documentId)}>
                تیک اعتبارسنجی
              </button>
            )}
          </div>
        ))}
      </div>

      {/* — paste ingest — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>چسباندن متن قانون</h3>
        <p className="hint">سند با همان sha256 دوبار قفسه نمی‌شود؛ ورژن جدید، فهرست قدیمی را بازنشسته می‌کند.</p>
        <input style={inputStyle} placeholder="عنوان کانونیک — مثلاً «قانون مدنی»" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea
          style={{ ...inputStyle, marginTop: 8, minHeight: 140, lineHeight: 1.9 }}
          placeholder="متن خام قانون…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <select style={{ ...inputStyle, flex: 1 }} value={tier} onChange={(e) => setTier(Number(e.target.value) as 1 | 2 | 3)}>
            <option value={3}>رده ۳ — عمومی</option>
            <option value={2}>رده ۲ — تأییدشدهٔ دفتر</option>
            <option value={1}>رده ۱ — رسمی</option>
          </select>
          <button className="btn primary" disabled={busy} onClick={() => void ingestText()}>قفسه کن</button>
        </div>
      </div>

      {/* — ingest-from-file — */}
      <div className="card">
        <h3 style={{ margin: '0 0 6px' }}>قفسه کردن از فایل‌های آپلودشده</h3>
        <p className="hint">همان فایل‌هایی که گذاشتی اینجا به عنوان منبع معتبر می‌آیند — در همان مسیر بدون ریسک متنِ ساخته‌ی LLM.</p>
        {files.length === 0 && <p className="hint">اول در تب فایل‌ها یکی آپلود کن.</p>}
        {files.map((f) => (
          <div key={f.fileId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px dashed var(--line)' }}>
            <span style={{ fontSize: 13 }}>📄 {f.filename} <small style={{ color: 'var(--text-dim)' }}>({f.analysis?.chars ?? '?'} نویسه)</small></span>
            <button className="btn" style={{ padding: '8px 14px' }} disabled={busy} onClick={() => void ingestFile(f.fileId)}>به کتابخانه</button>
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
