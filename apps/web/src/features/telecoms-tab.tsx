'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bell, CheckCircle2, CircleOff, DoorClosed, DoorOpen, MessageSquareText, PhoneCall, PhoneForwarded, Radio,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { num, tx } from '@/i18n';

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

/** Persian/Arabic-Indic digits → ASCII, everything else dropped. */
function digitsOnly(value: string): string {
  return value
    .replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)))
    .replace(/[^0-9]/g, '');
}

function errorText(e: unknown): string {
  return e instanceof ApiError || e instanceof Error ? e.message : tx('خطای ناشناخته', 'Unknown error');
}

export function TelecomsTab() {
  const [state, setState] = useState<TelecomsView | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [comms, setComms] = useState<CommsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

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
      /* API not reachable yet; the next poll retries */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => void refresh(), 8000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function act(path: string, body?: unknown) {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/dashboard/consultation/telecoms${path}`, body);
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function savePlans(next: TelecomsView['plans'], okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.post('/dashboard/consultation/telecoms/plans', { plans: next });
      setMsg({ ok: true, text: okText });
      await refresh();
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  const online = Boolean(state?.telecoms.online);
  const queueOpen = Boolean(state?.telecoms.queueOpen);

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="grid cols-2">
        <div className="card status-card">
          <h3>
            <span className={`status-dot ${online ? 'on' : ''}`} aria-hidden="true" />
            {online ? tx('آنلاین هستید', 'You are online') : tx('آفلاین هستید', 'You are offline')}
          </h3>
          <p className="hint">
            {tx(
              'وضعیت مشاورهٔ تلفنی شما. وقتی آفلاین باشید، مراجعان نمی‌توانند وارد صف شوند.',
              'Your phone-consultation status. While you are offline, clients cannot join the queue.',
            )}
          </p>
          <button className={`btn big ${online ? '' : 'primary'}`} disabled={busy || !state} onClick={() => act('/online', { online: !online })}>
            {online ? <CircleOff size={18} aria-hidden="true" /> : <Radio size={18} aria-hidden="true" />}
            {online ? tx('آفلاین شوم', 'Go offline') : tx('آنلاین شوم', 'Go online')}
          </button>
        </div>
        <div className="card status-card">
          <h3>
            {queueOpen ? <DoorOpen size={20} aria-hidden="true" /> : <DoorClosed size={20} aria-hidden="true" />}
            {queueOpen ? tx('صف باز است', 'The queue is open') : tx('صف بسته است', 'The queue is closed')}
          </h3>
          <p className="hint">
            {!queueOpen && state?.telecoms.closeReason
              ? state.telecoms.closeReason
              : tx(
                  'هر زمان بخواهید می‌توانید صف را ببندید؛ علت آن به مراجعان نمایش داده می‌شود.',
                  'You can close the queue at any time; clients see the reason.',
                )}
          </p>
          <button
            className={`btn big ${queueOpen ? '' : 'primary'}`}
            disabled={busy || !state}
            onClick={() =>
              act(queueOpen ? '/queue/close' : '/queue/open', queueOpen ? { reason: tx('ظرفیت امروز تکمیل شد.', 'Today’s capacity is full.') } : undefined)
            }
          >
            {queueOpen ? tx('بستن صف', 'Close the queue') : tx('باز کردن صف', 'Open the queue')}
          </button>
        </div>
      </div>
      {msg && (
        <p className={msg.ok ? 'form-ok' : 'form-error'} role={msg.ok ? 'status' : 'alert'}>
          {msg.text}
        </p>
      )}

      <div className="card">
        <div className="card-head">
          <h3>{tx(`صف انتظار: ${num(board?.waiting.length ?? 0)} نفر`, `Queue: ${num(board?.waiting.length ?? 0)} waiting`)}</h3>
          <button className="btn primary" disabled={busy || !board?.waiting.length} onClick={() => act('/queue/next')}>
            <PhoneForwarded size={17} aria-hidden="true" />
            {tx('نفر بعدی', 'Next client')}
          </button>
        </div>
        {!board?.waiting.length && <p className="empty-line">{tx('کسی در صف نیست.', 'Nobody is waiting.')}</p>}
        {board?.waiting.map((ticket, i) => (
          <div key={ticket.ticketId} className="kv">
            <span className="ticket-line">
              <b>{num(i + 1)}.</b>
              <span dir="ltr">{ticket.phone}</span>
              <span className="pill">{tx(`${num(ticket.minutes)} دقیقه`, `${num(ticket.minutes)} min`)}</span>
              {ticket.status === 'up_next' && (
                <span className="pill gold">
                  <Bell size={12} aria-hidden="true" />
                  {tx('به او اطلاع داده شد', 'Notified')}
                </span>
              )}
            </span>
            <div className="row-actions">
              {ticket.status === 'up_next' && (
                <button className="btn small" disabled={busy} onClick={() => act(`/queue/call/${ticket.ticketId}`)}>
                  <PhoneCall size={15} aria-hidden="true" />
                  {tx('شروع مشاوره', 'Start consultation')}
                </button>
              )}
              <button className="btn ghost small" disabled={busy} onClick={() => act(`/queue/skip/${ticket.ticketId}`)}>
                {tx('انتقال به انتهای صف', 'Move to the end')}
              </button>
            </div>
          </div>
        ))}
        {Boolean(board?.current.length) && (
          <>
            <h4 className="sub-head">{tx('در حال مشاوره', 'In consultation')}</h4>
            {board!.current.map((ticket) => (
              <div key={ticket.ticketId} className="kv">
                <span className="ticket-line">
                  <PhoneCall size={15} aria-hidden="true" />
                  <span dir="ltr">{ticket.phone}</span>
                  <span className="pill">{tx(`${num(ticket.minutes)} دقیقه`, `${num(ticket.minutes)} min`)}</span>
                </span>
                <div className="row-actions">
                  <button className="btn small" disabled={busy} onClick={() => act(`/queue/end/${ticket.ticketId}`, { endAs: 'done' })}>
                    <CheckCircle2 size={15} aria-hidden="true" />
                    {tx('پایان مشاوره', 'End consultation')}
                  </button>
                  <button className="btn ghost small" disabled={busy} onClick={() => act(`/queue/end/${ticket.ticketId}`, { endAs: 'no_show' })}>
                    {tx('حاضر نشد', 'No-show')}
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
        <p className="hint" style={{ marginTop: 12, marginBottom: 0 }}>
          {tx(
            `امروز: ${num(board?.doneToday ?? 0)} مشاورهٔ انجام‌شده · ${num(board?.states.noShow ?? 0)} غایب · ${num(board?.states.cancelled ?? 0)} انصراف`,
            `Today: ${num(board?.doneToday ?? 0)} completed · ${num(board?.states.noShow ?? 0)} no-shows · ${num(board?.states.cancelled ?? 0)} cancelled`,
          )}
        </p>
      </div>

      <div className="card">
        <h3>{tx('طرح‌های مشاوره', 'Consultation plans')}</h3>
        <p className="hint">
          {tx(
            'قیمت هر طرح را به تومان وارد کنید و «ذخیره» را بزنید. قیمت جدید بلافاصله برای مراجعان نمایش داده می‌شود.',
            'Enter each plan’s price in toman and press Save. Clients see the new price immediately.',
          )}
        </p>
        {state?.plans.map((p) => (
          <PlanRow
            key={p.minutes}
            plan={p}
            busy={busy}
            onSave={(price) =>
              savePlans(
                state.plans.map((x) => (x.minutes === p.minutes ? { ...x, priceToman: price } : x)),
                tx(`قیمت طرح ${num(p.minutes)} دقیقه‌ای ذخیره شد.`, `${num(p.minutes)}-minute plan price saved.`),
              )
            }
            onToggle={() =>
              savePlans(
                state.plans.map((x) => (x.minutes === p.minutes ? { ...x, active: !x.active } : x)),
                p.active
                  ? tx(`طرح ${num(p.minutes)} دقیقه‌ای غیرفعال شد.`, `${num(p.minutes)}-minute plan disabled.`)
                  : tx(`طرح ${num(p.minutes)} دقیقه‌ای فعال شد.`, `${num(p.minutes)}-minute plan enabled.`),
              )
            }
          />
        ))}
      </div>

      <CommsPanels comms={comms} refresh={refresh} />
    </div>
  );
}

function PlanRow({
  plan,
  busy,
  onSave,
  onToggle,
}: {
  plan: { minutes: number; priceToman: number; active: boolean };
  busy: boolean;
  onSave: (price: number) => void;
  onToggle: () => void;
}) {
  const [price, setPrice] = useState(String(plan.priceToman));
  useEffect(() => setPrice(String(plan.priceToman)), [plan.priceToman]);
  const parsed = Number(price);
  const dirty = price !== String(plan.priceToman);
  const valid = Number.isInteger(parsed) && parsed > 0;

  return (
    <div className="kv plan-row">
      <b>{tx(`${num(plan.minutes)} دقیقه`, `${num(plan.minutes)} minutes`)}</b>
      <form
        className="row-actions"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && valid) onSave(parsed);
        }}
      >
        <label className="sr-only" htmlFor={`plan-${plan.minutes}`}>
          {tx('قیمت به تومان', 'Price in toman')}
        </label>
        <input
          id={`plan-${plan.minutes}`}
          className="price-input"
          dir="ltr"
          inputMode="numeric"
          value={price}
          onChange={(e) => setPrice(digitsOnly(e.target.value))}
        />
        <span className="unit">{tx('تومان', 'toman')}</span>
        <button type="submit" className="btn small" disabled={busy || !dirty || !valid}>
          {tx('ذخیره', 'Save')}
        </button>
        <button
          type="button"
          className={`btn small ${plan.active ? '' : 'ghost'}`}
          aria-pressed={plan.active}
          disabled={busy}
          onClick={onToggle}
        >
          {plan.active ? tx('فعال', 'Active') : tx('غیرفعال', 'Inactive')}
        </button>
      </form>
    </div>
  );
}

const SMS_PROVIDERS: Array<{ id: 'kavenegar' | 'ghasedak'; fa: string; en: string }> = [
  { id: 'kavenegar', fa: 'کاوه‌نگار', en: 'Kavenegar' },
  { id: 'ghasedak', fa: 'قاصدک', en: 'Ghasedak' },
];

function CommsPanels({ comms, refresh }: { comms: CommsView | null; refresh: () => Promise<void> }) {
  const [provider, setProvider] = useState<'kavenegar' | 'ghasedak'>('kavenegar');
  const [smsKey, setSmsKey] = useState('');
  const [smsSender, setSmsSender] = useState('');
  const [smsTestTo, setSmsTestTo] = useState('');
  const [smsMsg, setSmsMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [callUrl, setCallUrl] = useState('');
  const [callAccount, setCallAccount] = useState('');
  const [callToken, setCallToken] = useState('');
  const [callFrom, setCallFrom] = useState('');
  const [callTestTo, setCallTestTo] = useState('');
  const [callMsg, setCallMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const providerName = (id?: string) => {
    const p = SMS_PROVIDERS.find((x) => x.id === id);
    return p ? tx(p.fa, p.en) : id ?? '';
  };

  async function wireSms() {
    setBusy(true);
    setSmsMsg(null);
    try {
      await api.post('/dashboard/comms/sms', { provider, apiKey: smsKey, senderLine: smsSender || undefined });
      setSmsMsg({
        ok: true,
        text: tx(
          'پنل پیامک متصل شد. از این پس کدهای ورود و اطلاع‌رسانی‌ها با همین پنل ارسال می‌شوند. کلید رمزنگاری‌شده ذخیره شد.',
          'SMS panel connected. Sign-in codes and notifications are now sent through it. The key was stored encrypted.',
        ),
      });
      setSmsKey('');
      await refresh();
    } catch (e) {
      setSmsMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function testSms() {
    setBusy(true);
    setSmsMsg(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; error?: string }>('/dashboard/comms/sms/test', { to: smsTestTo });
      setSmsMsg(
        r.ok
          ? { ok: true, text: tx(`پیامک بررسی اتصال ارسال شد (${num(r.latencyMs)} میلی‌ثانیه).`, `Connection-check SMS sent (${num(r.latencyMs)} ms).`) }
          : { ok: false, text: r.error ?? tx('ارسال ناموفق بود.', 'Sending failed.') },
      );
    } catch (e) {
      setSmsMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function wireCall() {
    setBusy(true);
    setCallMsg(null);
    try {
      await api.post('/dashboard/comms/call', { baseUrl: callUrl, accountId: callAccount, authToken: callToken, fromNumber: callFrom });
      setCallMsg({
        ok: true,
        text: tx('سرور تماس متصل شد. وقتی نوبت مراجعی برسد، درخواست تماس به آن فرستاده می‌شود.', 'Call server connected. When a client’s turn comes, a call request is sent to it.'),
      });
      setCallToken('');
      await refresh();
    } catch (e) {
      setCallMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  async function testCall() {
    setBusy(true);
    setCallMsg(null);
    try {
      const r = await api.post<{ ok: boolean; latencyMs: number; error?: string }>('/dashboard/comms/call/test', { to: callTestTo });
      setCallMsg(
        r.ok
          ? { ok: true, text: tx(`سرور تماس درخواست را پذیرفت (${num(r.latencyMs)} میلی‌ثانیه).`, `The call server accepted the request (${num(r.latencyMs)} ms).`) }
          : { ok: false, text: r.error ?? tx('تماس بررسی اتصال برقرار نشد.', 'The connection-check call failed.') },
      );
    } catch (e) {
      setCallMsg({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid cols-2">
      <div className="card">
        <h3 className="title-row">
          <MessageSquareText size={19} aria-hidden="true" />
          {tx('پنل پیامک', 'SMS panel')}
          {comms?.sms.configured && (
            <span className="pill ok">
              {providerName(comms.sms.provider)} · <span dir="ltr">{comms.sms.apiKeyMasked}</span>
            </span>
          )}
        </h3>
        <p className="hint">
          {tx(
            'پنل پیامک دفتر (کاوه‌نگار یا قاصدک). پس از اتصال، کدهای ورود و اطلاع‌رسانی نوبت به مراجعان با همین پنل ارسال می‌شود.',
            'The office’s SMS panel (Kavenegar or Ghasedak). Once connected, sign-in codes and queue notifications are sent through it.',
          )}
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && smsKey) void wireSms();
          }}
        >
          <div className="segmented" role="radiogroup" aria-label={tx('سرویس پیامک', 'SMS provider')}>
            {SMS_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={provider === p.id}
                className={`tab ${provider === p.id ? 'active' : ''}`}
                onClick={() => setProvider(p.id)}
              >
                {tx(p.fa, p.en)}
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="sms-key">{tx('کلید API', 'API key')}</label>
            <input
              id="sms-key"
              dir="ltr"
              type="password"
              autoComplete="off"
              value={smsKey}
              onChange={(e) => setSmsKey(e.target.value)}
              placeholder={tx('رمزنگاری‌شده ذخیره می‌شود', 'Stored encrypted')}
            />
          </div>
          <div className="field">
            <label htmlFor="sms-sender">{tx('شمارهٔ خط ارسال (اختیاری)', 'Sender line (optional)')}</label>
            <input id="sms-sender" dir="ltr" inputMode="numeric" value={smsSender} onChange={(e) => setSmsSender(digitsOnly(e.target.value))} />
          </div>
          <button type="submit" className="btn primary" disabled={busy || !smsKey}>
            {comms?.sms.configured ? tx('به‌روزرسانی اتصال', 'Update connection') : tx('اتصال', 'Connect')}
          </button>
        </form>
        {comms?.sms.configured && (
          <form
            className="test-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && smsTestTo) void testSms();
            }}
          >
            <div className="field">
              <label htmlFor="sms-test">{tx('ارسال پیامک بررسی اتصال به', 'Send a connection-check SMS to')}</label>
              <input id="sms-test" dir="ltr" inputMode="tel" value={smsTestTo} onChange={(e) => setSmsTestTo(digitsOnly(e.target.value))} placeholder="09XXXXXXXXX" />
            </div>
            <button type="submit" className="btn" disabled={busy || !smsTestTo}>
              {tx('ارسال', 'Send')}
            </button>
          </form>
        )}
        {smsMsg && (
          <p className={smsMsg.ok ? 'form-ok' : 'form-error'} role={smsMsg.ok ? 'status' : 'alert'}>
            {smsMsg.text}
          </p>
        )}
      </div>

      <div className="card">
        <h3 className="title-row">
          <PhoneCall size={19} aria-hidden="true" />
          {tx('سرور تماس (اختیاری)', 'Call server (optional)')}
          {comms?.call.configured && (
            <span className="pill ok">
              {tx('متصل', 'Connected')} · <span dir="ltr">{comms.call.fromNumber}</span>
            </span>
          )}
        </h3>
        <p className="hint">
          {tx(
            'اگر دفتر سرور تماس خودکار دارد، نشانی آن را وارد کنید. وقتی نوبت مراجعی برسد، درخواست POST به ‎/calls‎ آن فرستاده می‌شود. بدون آن، مراجع با پیامک و اعلان باخبر می‌شود.',
            'If the office has an automated call server, enter its address. When a client’s turn comes, a POST request is sent to its /calls endpoint. Without it, the client is notified by SMS and in-app notice.',
          )}
        </p>
        <details className="reveal compact">
          <summary>{tx('تنظیمات سرور تماس', 'Call server settings')}</summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy && callUrl && callAccount && callToken && callFrom) void wireCall();
            }}
          >
            <div className="field">
              <label htmlFor="call-url">{tx('نشانی سرور', 'Server URL')}</label>
              <input id="call-url" dir="ltr" value={callUrl} onChange={(e) => setCallUrl(e.target.value)} placeholder="https://CALL-SERVER/api" />
            </div>
            <div className="field">
              <label htmlFor="call-account">{tx('شناسهٔ حساب', 'Account ID')}</label>
              <input id="call-account" dir="ltr" value={callAccount} onChange={(e) => setCallAccount(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="call-token">{tx('توکن دسترسی', 'Access token')}</label>
              <input id="call-token" dir="ltr" type="password" autoComplete="off" value={callToken} onChange={(e) => setCallToken(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="call-from">{tx('شمارهٔ تماس‌گیرنده', 'Caller number')}</label>
              <input id="call-from" dir="ltr" inputMode="tel" value={callFrom} onChange={(e) => setCallFrom(digitsOnly(e.target.value))} placeholder="021XXXXXXXX" />
            </div>
            <button type="submit" className="btn primary" disabled={busy || !callUrl || !callAccount || !callToken || !callFrom}>
              {tx('اتصال', 'Connect')}
            </button>
          </form>
          {comms?.call.configured && (
            <form
              className="test-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (!busy && callTestTo) void testCall();
              }}
            >
              <div className="field">
                <label htmlFor="call-test">{tx('تماس بررسی اتصال با', 'Connection-check call to')}</label>
                <input id="call-test" dir="ltr" inputMode="tel" value={callTestTo} onChange={(e) => setCallTestTo(digitsOnly(e.target.value))} placeholder="09XXXXXXXXX" />
              </div>
              <button type="submit" className="btn" disabled={busy || !callTestTo}>
                {tx('تماس', 'Call')}
              </button>
            </form>
          )}
        </details>
        {callMsg && (
          <p className={callMsg.ok ? 'form-ok' : 'form-error'} role={callMsg.ok ? 'status' : 'alert'}>
            {callMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}
