'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';

interface TelecomsView {
  telecoms: { online: boolean; queueOpen: boolean; closeReason?: string; updatedAt: string };
  waitingCount: number;
  plans: Array<{ minutes: number; priceToman: number; active: boolean }>;
}

interface Ticket {
  ticketId: string;
  phone: string;
  minutes: number;
  status: string;
  joinedAt: string;
}

interface Board {
  waiting: Ticket[];
  current: Ticket[];
  doneToday: number;
  states: { noShow: number; cancelled: number };
}

interface CommsView {
  sms: { configured: boolean; provider?: string; baseUrl?: string; apiKeyMasked?: string; senderLine?: string };
  call: { configured: boolean; baseUrl?: string; fromNumber?: string };
}

export function TelecomsTab() {
  const [state, setState] = useState<TelecomsView | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [comms, setComms] = useState<CommsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, b, c] = await Promise.all([
        api.get<TelecomsView>('/dashboard/consultation/telecoms'),
        api.get<Board>('/dashboard/consultation/telecoms/queue'),
        api.get<CommsView>('/dashboard/comms/view'),
      ]);
      setState(t);
      setBoard(b);
      setComms(c);
    } catch {
      /* booting */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(refresh, 8000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setMsg(null);
    try {
      await api.post(`/dashboard/consultation/telecoms${path}`, body);
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      {/* — the master toggles — */}
      <div className="grid cols-2">
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>{state?.telecoms.online ? '🟢 آنلاین' : '⚫ آفلاین'}</h3>
          <p className="hint">چراغ مشاورهٔ تلفنی تو — خاموشش کنی ملت نمی‌تونن وارد صف بشن.</p>
          <button
            className={`btn big ${state?.telecoms.online ? '' : 'primary'}`}
            disabled={busy}
            onClick={() => act('/online', { online: !state?.telecoms.online })}
          >
            {state?.telecoms.online ? 'برم آفلاین' : 'بیا آنلاین'}
          </button>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <h3 style={{ marginTop: 0 }}>{state?.telecoms.queueOpen ? '🚪 صف باز' : '🔒 صف بسته'}</h3>
          <p className="hint">{state?.telecoms.closeReason ?? 'هر وقت خواستی ببندش — ملت علتش را می‌بینند.'}</p>
          <button
            className={`btn big ${state?.telecoms.queueOpen ? '' : 'primary'}`}
            disabled={busy}
            onClick={() => act(state?.telecoms.queueOpen ? '/queue/close' : '/queue/open', state?.telecoms.queueOpen ? { reason: 'ظرفیت امروز تکمیل شد' } : undefined)}
          >
            {state?.telecoms.queueOpen ? 'صف را ببند' : 'صف را باز کن'}
          </button>
        </div>
      </div>
      {msg && <p className="pill bad" style={{ justifyContent: 'center' }}>{msg}</p>}

      {/* — the line — */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>صف: {board?.waiting.length ?? 0} نفر در انتظار</h3>
          <button className="btn primary" disabled={busy} onClick={() => act('/queue/next')}>📞 نفر بعد</button>
        </div>
        {!board?.waiting.length && <p className="hint">هیچ‌کس توی صف نیست.</p>}
        {board?.waiting.map((t, i) => (
          <div key={t.ticketId} className="kv">
            <b>{(i + 1).toLocaleString('fa-IR')}. {t.phone} — {t.minutes} دقیقه {t.status === 'up_next' && '🔔 صدا زده شد'}</b>
            <div style={{ display: 'flex', gap: 6 }}>
              {t.status === 'up_next' && (
                <button className="btn" disabled={busy} onClick={() => act(`/queue/call/${t.ticketId}`)}>شروع تماس</button>
              )}
              <button className="btn ghost" disabled={busy} onClick={() => act(`/queue/skip/${t.ticketId}`)}>بفرست ته صف</button>
            </div>
          </div>
        ))}
        {Boolean(board?.current.length) && (
          <>
            <h4 style={{ margin: '12px 0 6px' }}>در حال مشاوره:</h4>
            {board!.current.map((t) => (
              <div key={t.ticketId} className="kv">
                <b>☎️ {t.phone} ({t.minutes} دقیقه)</b>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn" disabled={busy} onClick={() => act(`/queue/end/${t.ticketId}`, { endAs: 'done' })}>✅ تمام شد</button>
                  <button className="btn ghost" disabled={busy} onClick={() => act(`/queue/end/${t.ticketId}`, { endAs: 'no_show' })}>نیامد</button>
                </div>
              </div>
            ))}
          </>
        )}
        <p className="hint" style={{ marginTop: 10, fontSize: 11 }}>امروز: {board?.doneToday ?? 0} مشاورهٔ موفق · {board?.states.noShow ?? 0}غایب · {board?.states.cancelled ?? 0} انصراف</p>
      </div>

      {/* — plans pricing — */}
      <div className="card">
        <h3>پلن‌ها (۱۰/۲۰/۳۰ دقیقه)</h3>
        <p className="hint">قیمت تومانیِ هر پلن دست خودته — ذخیره که کنی فروشگاهِ ملت همان لحظه آپدیت می‌شود.</p>
        {state?.plans.map((p) => (
          <div key={p.minutes} className="kv">
            <b>{p.minutes} دقیقه</b>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                dir="ltr"
                style={{ width: 110, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 8px' }}
                defaultValue={p.priceToman}
                onBlur={async (e) => {
                  const v = Number(e.target.value.replace(/[^0-9]/g, '')) || p.priceToman;
                  const next = state.plans.map((x) => (x.minutes === p.minutes ? { ...x, priceToman: v } : x));
                  await api.post('/dashboard/consultation/telecoms/plans', { plans: next });
                  void refresh();
                }}
              />
              <span className="pill">تومان</span>
              <button
                className={`btn ${p.active ? '' : 'ghost'}`}
                disabled={busy}
                onClick={async () => {
                  const next = state.plans.map((x) => (x.minutes === p.minutes ? { ...x, active: !x.active } : x));
                  await api.post('/dashboard/consultation/telecoms/plans', { plans: next });
                  void refresh();
                }}
              >
                {p.active ? 'فعال ✅' : 'غیرفعال'}
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* — comms panels — */}
      <CommsPanels comms={comms} refresh={refresh} />
    </div>
  );
}

function CommsPanels({ comms, refresh }: { comms: CommsView | null; refresh: () => Promise<void> }) {
  const [smsUrl, setSmsUrl] = useState('https://api.kavenegar.com');
  const [smsKey, setSmsKey] = useState('');
  const [smsSender, setSmsSender] = useState('');
  const [smsTestTo, setSmsTestTo] = useState('');
  const [smsMsg, setSmsMsg] = useState<string | null>(null);
  const [callUrl, setCallUrl] = useState('');
  const [callAccount, setCallAccount] = useState('');
  const [callToken, setCallToken] = useState('');
  const [callFrom, setCallFrom] = useState('');
  const [callTestTo, setCallTestTo] = useState('');
  const [callMsg, setCallMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function wireSms() {
    setBusy(true); setSmsMsg(null);
    try {
      await api.post('/dashboard/comms/sms', { provider: 'kavenegar', baseUrl: smsUrl, apiKey: smsKey, senderLine: smsSender || undefined });
      setSmsMsg('پنل پیامکی وصل شد ✅ کلید ذخیره شد و دیگر کامل نشان داده نمی‌شود.');
      setSmsKey('');
      await refresh();
    } catch (e) { setSmsMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function testSms() {
    setBusy(true); setSmsMsg(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; error?: string }>('/dashboard/comms/sms/test', { to: smsTestTo });
      setSmsMsg(r.ok ? `پیامک واقعی پرید ✅ (${r.latencyMs}ms)` : `❌ ${r.error}`);
    } catch (e) { setSmsMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function wireCall() {
    setBusy(true); setCallMsg(null);
    try {
      await api.post('/dashboard/comms/call', { baseUrl: callUrl, accountId: callAccount, authToken: callToken, fromNumber: callFrom });
      setCallMsg('پنل تماس وصل شد ✅ نوبت‌ها بالاخره «واقعاً زنگ می‌زنند».');
      setCallToken('');
      await refresh();
    } catch (e) { setCallMsg((e as Error).message); } finally { setBusy(false); }
  }

  async function testCall() {
    setBusy(true); setCallMsg(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; error?: string }>('/dashboard/comms/call/test', { to: callTestTo });
      setCallMsg(r.ok ? `تماس تستی پا شد ✅ (${r.latencyMs}ms)` : `❌ ${r.error}`);
    } catch (e) { setCallMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>📨 پنل پیامکی {comms?.sms.configured && <span className="pill ok">وصل {comms.sms.apiKeyMasked}</span>}</h3>
        <p className="hint">Kavenegar، قاصدک، SMS.ir یا هر URL سفارشی — مشتری‌ها نوبتشان را با SMS هم می‌فهمند.</p>
        <div className="field"><label>آدرس پنل</label><input dir="ltr" value={smsUrl} onChange={(e) => setSmsUrl(e.target.value)} /></div>
        <div className="field"><label>کلید API</label><input dir="ltr" type="password" value={smsKey} onChange={(e) => setSmsKey(e.target.value)} placeholder="حتماً محرمانه‌ات ذخیره می‌شود" /></div>
        <div className="field"><label>خط ارسال (اختیاری)</label><input dir="ltr" value={smsSender} onChange={(e) => setSmsSender(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn primary" disabled={busy || !smsUrl || !smsKey} onClick={wireSms}>وصل کن</button>
        </div>
        {comms?.sms.configured && (
          <>
            <div className="field" style={{ marginTop: 10 }}><label>تست پیامک به:</label><input dir="ltr" value={smsTestTo} onChange={(e) => setSmsTestTo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0912…" /></div>
            <button className="btn" disabled={busy || !smsTestTo} onClick={testSms}>تست واقعی بزن</button>
          </>
        )}
        {smsMsg && <p className="hint" style={{ marginTop: 8 }}>{smsMsg}</p>}
      </div>

      <div className="card">
        <h3>📞 پنل تماس {comms?.call.configured && <span className="pill ok">وصل — خط {comms.call.fromNumber}</span>}</h3>
        <p className="hint">سرور تماس خودت — وقت نوبت کسی برسد، ملت را با این خط صدا می‌کنیم.</p>
        <div className="field"><label>آدرس سرور تماس</label><input dir="ltr" value={callUrl} onChange={(e) => setCallUrl(e.target.value)} placeholder="https://my-callbox/api" /></div>
        <div className="field"><label>Account ID</label><input dir="ltr" value={callAccount} onChange={(e) => setCallAccount(e.target.value)} /></div>
        <div className="field"><label>Auth Token</label><input dir="ltr" type="password" value={callToken} onChange={(e) => setCallToken(e.target.value)} /></div>
        <div className="field"><label>شماره نمایشی</label><input dir="ltr" value={callFrom} onChange={(e) => setCallFrom(e.target.value)} placeholder="021…" /></div>
        <button className="btn primary" disabled={busy || !callUrl || !callAccount || !callToken || !callFrom} onClick={wireCall}>وصل کن</button>
        {comms?.call.configured && (
          <>
            <div className="field" style={{ marginTop: 10 }}><label>تست تماس به:</label><input dir="ltr" value={callTestTo} onChange={(e) => setCallTestTo(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0912…" /></div>
            <button className="btn" disabled={busy || !callTestTo} onClick={testCall}>تماس تستی بده</button>
          </>
        )}
        {callMsg && <p className="hint" style={{ marginTop: 8 }}>{callMsg}</p>}
      </div>
    </div>
  );
}
