'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getToken, setToken, type Catalog, type NotificationView, type TossPosition, type WalletView } from '@/lib/api';

type TabId = 'shop' | 'wallet' | 'queue' | 'inbox';

const SUB_FA: Record<string, { title: string; emoji: string; desc: string }> = {
  ai_chat: { title: 'چت با AI وکیل', emoji: '💬', desc: 'پرسش و گفت‌وگوی بی‌حد' },
  ai_filelab: { title: 'آزمایشگاه فایل', emoji: '📁', desc: 'تحلیل سند توسط لیدر' },
  ai_kitchen: { title: 'نمایش زندهٔ ایجنت‌ها', emoji: '🍳', desc: 'ببین AI چطور کار می‌کند' },
  ai_voice: { title: 'تماس صوتی با لیدر', emoji: '🎙️', desc: 'حرف بزن، جواب بشنَو' },
};

export default function ClientHome() {
  const [tab, setTab] = useState<TabId>('shop');
  const [token, setTokenState] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [queuePos, setQueuePos] = useState<TossPosition | null>(null);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  // PWA install capture
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/sw.js');
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setCatalog(await api.get<Catalog>('/client/catalog'));
      setCatalogError(false);
    } catch {
      setCatalogError(true);
    }
    if (!getToken()) return;
    try {
      const [w, q, n] = await Promise.all([
        api.get<WalletView>('/client/wallet'),
        api.get<{ position: TossPosition | null }>('/client/queue/me'),
        api.get<{ notifications: NotificationView[] }>('/client/notifications'),
      ]);
      setWallet(w);
      setQueuePos(q.position);
      setNotifications(n.notifications);
    } catch {
      /* signed off or sandbox without DB yet */
    }
  }, []);

  useEffect(() => {
    const existing = getToken();
    setTokenState(existing);
    void refresh();
    const t = setInterval(refresh, 12_000); // live-ish queue position
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <div className="shell" style={{ maxWidth: 760 }}>
      <header className="topbar">
        <div className="brand">
          <div className="logo">⚖️</div>
          <div>
            <h1>مشاوره حقوقی آنلاین</h1>
            <small>وقت بگیر، صف را ببین، جواب شفاف</small>
          </div>
        </div>
        {token ? (
          <button className="btn ghost" onClick={() => { setToken(null); setTokenState(null); }}>خروج</button>
        ) : null}
      </header>

      {installPrompt && (
        <div className="install-banner">
          <span style={{ fontSize: 13 }}>📲 اپ را روی گوشی‌ات نصب کن — نوبتت را بدون باز شدن سایت می‌فهمی</span>
          <button className="btn primary" onClick={() => void (installPrompt as unknown as { prompt(): void }).prompt()}>
            نصب
          </button>
        </div>
      )}

      {!token ? (
        <OtpCard onDone={(tok) => { setTokenState(tok); void refresh(); }} />
      ) : (
        <>
          <nav className="tabs">
            {(
              [
                ['shop', '🛍️', 'فروشگاه'],
                ['wallet', '💰', 'کیف پول'],
                ['queue', '🎟️', 'نوبت من'],
                ['inbox', '🔔', 'اعلان‌ها'],
              ] as Array<[TabId, string, string]>
            ).map(([id, icon, label]) => (
              <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <span>{icon}</span>
                <span>{label}</span>
                {id === 'inbox' && notifications.some((n) => !n.read) && (
                  <span className="pill gold" style={{ fontSize: 10, padding: '1px 7px' }}>
                    {notifications.filter((n) => !n.read).length}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {tab === 'shop' && <ShopTab catalog={catalog} catalogError={catalogError} wallet={wallet} refresh={refresh} setTab={setTab} />}
          {tab === 'wallet' && <WalletTab wallet={wallet} refresh={refresh} />}
          {tab === 'queue' && <QueueTab position={queuePos} wallet={wallet} catalog={catalog} refresh={refresh} />}
          {tab === 'inbox' && <InboxTab notifications={notifications} refresh={refresh} />}
        </>
      )}
    </div>
  );
}

/* ————— auth ————— */

function OtpCard({ onDone }: { onDone: (t: string) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function call(path: string, body: unknown, ok: (r: { accessToken?: string }) => void) {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ accessToken?: string }>(`/auth${path}`, body);
      ok(r);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <h3>ورود / ثبت‌نام</h3>
        <p className="hint">با شماره موبایلت وارد شو — خریدها و نوبت‌هات به همین خط می‌آید.</p>
        <div className="field">
          <label>شماره موبایل</label>
          <input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0912…" />
        </div>
        {sent && (
          <div className="field">
            <label>کد تأیید</label>
            <input dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
          </div>
        )}
        {err && <p className="hint" style={{ color: 'var(--bad)' }}>{err}</p>}
        {!sent ? (
          <button className="btn primary big" disabled={busy || !/^09\d{9}$/.test(phone)} onClick={() => call('/otp/request', { phone }, () => setSent(true))}>
            ارسال کد
          </button>
        ) : (
          <button className="btn primary big" disabled={busy || code.length < 5} onClick={() => call('/otp/verify', { phone, code }, (r) => { if (r.accessToken) { setToken(r.accessToken); onDone(r.accessToken); } })}>
            ورود
          </button>
        )}
      </div>
    </div>
  );
}

/* ————— shop ————— */

function ShopTab({ catalog, catalogError, wallet, refresh, setTab }: {
  catalog: Catalog | null;
  catalogError: boolean;
  wallet: WalletView | null;
  refresh: () => Promise<void>;
  setTab: (t: TabId) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function buyConsultation(minutes: number) {
    if (busy) return;
    setBusy(`c${minutes}`); setMsg(null);
    try {
      await api.post('/client/purchases/consultation', { minutes, payWith: 'wallet' });
      setMsg(`وقت ${minutes} دقیقه‌ای خریداری شد! از تب «نوبت من» وارد صف شو.`);
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  }

  async function buySubscription(feature: string, months: number) {
    if (busy) return;
    setBusy(`s${feature}${months}`); setMsg(null);
    try {
      await api.post('/client/purchases/subscription', { feature, months, payWith: 'wallet' });
      setMsg('اشتراک فعال شد ✅');
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
    }
  }

  if (catalogError) return <div className="card"><p className="hint">فعلاً به فروشگاه وصل نمی‌شوم — صفحه را تازه کن.</p></div>;
  if (!catalog) return <div className="card"><p className="hint">…</p></div>;

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '4px 0' }}>مشاورهٔ حقوقی واقعی، با وکیل واقعی</h2>
        <p className="hint">مدت را انتخاب کن — مستقیم از کیف پول پرداخت می‌شود و وارد صف می‌روی.</p>
        {wallet && <p className="pill teal">موجودی: {wallet.balanceToman.toLocaleString('fa-IR')} تومان</p>}
      </div>

      <div className="grid cols-3">
        {catalog.consultation.map((p) => (
          <div key={p.minutes} className="card plan-card">
            <div className="minutes">{p.minutes}<small> دقیقه</small></div>
            <div className="price">{p.priceToman.toLocaleString('fa-IR')} تومان</div>
            <button className="btn primary big" disabled={busy !== null || !wallet || wallet.balanceToman < p.priceToman} onClick={() => buyConsultation(p.minutes)}>
              {busy === `c${p.minutes}` ? '…' : wallet && wallet.balanceToman < p.priceToman ? 'کیف پولت را شارژ کن' : 'خرید و ورود به صف'}
            </button>
            {wallet && wallet.balanceToman < p.priceToman && (
              <button className="btn ghost" style={{ marginTop: 6, width: '100%' }} onClick={() => setTab('wallet')}>
                → شارژ کیف پول
              </button>
            )}
          </div>
        ))}
      </div>
      {msg && <p className="pill gold" style={{ justifyContent: 'center' }}>{msg}</p>}

      <div className="card">
        <h3>اشتراک امکانات AI</h3>
        <p className="hint">هر بخشِ هوش مصنوعی، اشتراک خودش را دارد — فقط برای همان چیزی پرداخت کن که می‌خواهی.</p>
        <div className="grid cols-2">
          {catalog.subscriptions.map((s) => {
            const meta = SUB_FA[s.feature] ?? { title: s.feature, emoji: '✨', desc: '' };
            return (
              <div key={s.feature} className="card">
                <div style={{ fontSize: 26 }}>{meta.emoji}</div>
                <h3 style={{ margin: '6px 0 2px' }}>{meta.title}</h3>
                <p className="hint" style={{ marginBottom: 10 }}>{meta.desc}</p>
                {([1, 3, 12] as const).map((m) => (
                  <div key={m} className="kv">
                    <b>{m} ماه — {(s.prices as unknown as Record<number, number>)[m].toLocaleString('fa-IR')} تومان</b>
                    <button className="btn" disabled={busy !== null} onClick={() => buySubscription(s.feature, m)}>
                      {busy === `s${s.feature}${m}` ? '…' : 'خرید'}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ————— wallet ————— */

function WalletTab({ wallet, refresh }: { wallet: WalletView | null; refresh: () => Promise<void> }) {
  const [amount, setAmount] = useState('500000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function topup() {
    setBusy(true); setMsg(null);
    try {
      const start = await api.post<{ sessionId: string; redirectUrl: string }>('/client/wallet/topup', { amountToman: Number(amount) || 0 });
      // در محیط سندباکس گیت‌وی «mock» است — صفحهٔ پرداخت مستقیم تایید می‌کند.
      const conf = await api.post<{ credited: boolean; balanceToman: number }>('/client/wallet/topup/confirm', { sessionId: start.sessionId });
      setMsg(conf.credited ? `کیف پولت ${conf.balanceToman.toLocaleString('fa-IR')} تومان شد ✅` : 'پرداخت هنوز تایید نشده (درگاه واقعی به اینجا وصل می‌شود).');
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card" style={{ textAlign: 'center', padding: 30 }}>
        <p className="hint" style={{ margin: 0 }}>موجودی کیف پول</p>
        <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--gold)', margin: '6px 0 14px' }}>
          {(wallet?.balanceToman ?? 0).toLocaleString('fa-IR')} <small style={{ fontSize: 14 }}>تومان</small>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input dir="ltr" style={{ flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))} />
          <button className="btn primary" disabled={busy} onClick={topup}>{busy ? '…' : 'شارژ کیف پول'}</button>
        </div>
        {msg && <p className="pill gold" style={{ marginTop: 10 }}>{msg}</p>}
      </div>

      <div className="card">
        <h3>تراکنش‌های اخیر</h3>
        {!wallet?.txns.length && <p className="hint">هنوز تراکنشی نیست.</p>}
        {wallet?.txns.map((t) => (
          <div key={t.id} className="kv">
            <b>{t.note}</b>
            <span className={t.amountToman > 0 ? 'pill ok' : 'pill bad'}>
              {t.amountToman > 0 ? '+' : '−'}{Math.abs(t.amountToman).toLocaleString('fa-IR')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————— queue ————— */

function QueueTab({ position, wallet, catalog, refresh }: {
  position: TossPosition | null;
  wallet: WalletView | null;
  catalog: Catalog | null;
  refresh: () => Promise<void>;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function buyAndJoin(minutes: number) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const purchase = await api.post<{ id: string }>('/client/purchases/consultation', { minutes, payWith: 'wallet' });
      await api.post('/client/queue/join', { purchaseId: purchase.id, phone: phone.replace(/[^0-9]/g, '') });
      setMsg('وارد صف شدی — نوبتت را زیر همین صفحه دنبال کن. 📍');
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!position) return;
    setBusy(true);
    try {
      await api.post(`/client/queue/cancel/${position.ticket.ticketId}`);
      setMsg('بلیت کنسل شد و وجه به کیف پولت برگشت.');
      await refresh();
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(false);
    }
  }

  if (position) {
    return (
      <div className="grid" style={{ gap: 14 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="hint" style={{ margin: 0 }}>{position.ticket.status === 'up_next' ? '🔔 صدات کردند!' : position.ticket.status === 'in_call' ? '📞 در حال مشاوره' : 'نفر چندم صف؟'}</p>
          <div className="pos-ring">
            <div>
              <div className="num">{position.ticket.status === 'waiting' ? position.position.toLocaleString('fa-IR') : position.ticket.status === 'up_next' ? 'تو!' : '☎️'}</div>
              {position.ticket.status === 'waiting' && <div className="hint">{position.waitingAhead.toLocaleString('fa-IR')} نفر جلوتر</div>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill teal">⏱ حدود {position.etaMinutes.toLocaleString('fa-IR')} دقیقه صبر</span>
            <span className={`pill ${position.lawyerOnline ? 'ok' : 'bad'}`}>{position.lawyerOnline ? 'وکیل آنلاین است' : 'وکیل آفلاین است'}</span>
            <span className="pill">وقت {position.ticket.minutes} دقیقه‌ای</span>
          </div>
          {position.ticket.status === 'waiting' && (
            <button className="btn glass" style={{ marginTop: 14, color: 'var(--bad)' }} disabled={busy} onClick={cancel}>
              انصراف و برگشت وجه
            </button>
          )}
          {position.ticket.status === 'up_next' && (
            <div className="proposal-card" style={{ marginTop: 14 }}>
              <b>آماده باش!</b> لینک مشاوره به پیامک/اعلان اومده — یا آماده بمون تا وکیل زنگ بزنه.
            </div>
          )}
        </div>
        <p className="hint" style={{ textAlign: 'center', marginTop: 0 }}>نوبت که نزدیک شود پیامک + اعلان داخل اپ می‌گیری.</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>وارد صف شو</h3>
        <p className="hint">موبایلت را بده — همان خطی که نتیجهٔ تماس و نوبت می‌آید.</p>
        <div className="field">
          <input dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0912…" />
        </div>
        {catalog?.consultation.map((p) => (
          <div key={p.minutes} className="kv">
            <b>{p.minutes} دقیقه — {p.priceToman.toLocaleString('fa-IR')} تومانی</b>
            <button
              className="btn primary"
              disabled={busy || !/^09\d{9}$/.test(phone) || !wallet || wallet.balanceToman < p.priceToman}
              onClick={() => buyAndJoin(p.minutes)}
            >
              {busy ? '…' : 'خرید و ورود به صف'}
            </button>
          </div>
        ))}
        {wallet && catalog?.consultation?.[0] && wallet.balanceToman < catalog.consultation[0].priceToman && (
          <p className="hint" style={{ color: 'var(--rose)' }}>موجودی کافی نیست — اول کیف پولت را شارژ کن.</p>
        )}
        {msg && <p className="pill gold" style={{ marginTop: 8 }}>{msg}</p>}
      </div>
    </div>
  );
}

/* ————— inbox ————— */

function InboxTab({ notifications, refresh }: { notifications: NotificationView[]; refresh: () => Promise<void> }) {
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read).map((n) => n.notificationId);
    if (unread.length) {
      void api.post('/client/notifications/read', { notificationIds: unread }).then(refresh);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      {!notifications.length && <div className="card"><p className="hint">هنوز اعلانی نیامده — اولین خریدت / ورودت به صف اینجا خبرش می‌آورد.</p></div>}
      {[...notifications].reverse().map((n) => (
        <div key={n.notificationId} className="card" style={{ opacity: n.read ? 0.75 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>{n.titleFa}</b>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {n.delivered.sms && <span className="pill teal">پیامک ✅</span>}
              <span className="pill">{new Date(n.at).toLocaleTimeString('fa-IR')}</span>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>{n.bodyFa}</p>
        </div>
      ))}
    </div>
  );
}

/* ————— shared ————— */

function errText(e: unknown): string {
  const b = (e as { body?: { error?: { message?: string }; message?: string } }).body;
  return b?.error?.message ?? b?.message ?? 'خطا — اتصال یا آیتم را چک کن';
}
