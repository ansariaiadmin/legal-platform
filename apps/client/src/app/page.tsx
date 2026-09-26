'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  errText,
  getToken,
  setToken,
  signOut,
  SIGNED_OUT_EVENT,
  type Catalog,
  type NotificationView,
  type PurchaseView,
  type QueuePosition,
  type SessionUser,
  type TelecomsView,
  type WalletView,
} from '@/lib/api';

type TabId = 'consult' | 'wallet' | 'inbox';

const PENDING_TOPUP_KEY = 'lp_portal_pending_topup';
const fa = (n: number) => n.toLocaleString('fa-IR');

/** +989121234567 → 09121234567 */
function localPhone(normalized: string | null | undefined): string {
  if (!normalized) return '';
  const digits = normalized.replace(/[^0-9]/g, '');
  if (digits.startsWith('98') && digits.length === 12) return `0${digits.slice(2)}`;
  return digits.startsWith('09') ? digits : '';
}

export default function ClientHome() {
  const [tab, setTab] = useState<TabId>('consult');
  const [token, setTokenState] = useState<string | null>(null);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [position, setPosition] = useState<QueuePosition | null>(null);
  const [telecoms, setTelecoms] = useState<TelecomsView | null>(null);
  const [purchases, setPurchases] = useState<PurchaseView[]>([]);
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [topupNotice, setTopupNotice] = useState<string | null>(null);

  // Installable app (PWA)
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/portal/sw.js', { scope: '/portal/' });
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
      const [w, q, p, n] = await Promise.all([
        api.get<WalletView>('/client/wallet'),
        api.get<{ position: QueuePosition | null; telecoms: TelecomsView }>('/client/queue/me'),
        api.get<{ consultations: PurchaseView[] }>('/client/my-purchases'),
        api.get<{ notifications: NotificationView[] }>('/client/notifications'),
      ]);
      setWallet(w);
      setPosition(q.position);
      setTelecoms(q.telecoms);
      setPurchases(p.consultations);
      setNotifications(n.notifications);
    } catch {
      /* signed out or server unreachable; the next poll retries */
    }
  }, []);

  const loadMe = useCallback(async () => {
    try {
      setMe(await api.get<SessionUser>('/auth/me'));
    } catch {
      setMe(null);
    }
  }, []);

  // Session bootstrap, sign-out on expiry, and polling for the queue position.
  useEffect(() => {
    setTokenState(getToken());
    if (getToken()) void loadMe();
    void refresh();
    const onSignedOut = () => {
      setTokenState(null);
      setMe(null);
    };
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    const timer = setInterval(refresh, 12_000);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
    };
  }, [refresh, loadMe]);

  // Return from the payment gateway: /portal/?topup=return&Authority=…&Status=OK|NOK
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('topup') !== 'return') return;
    window.history.replaceState(null, '', window.location.pathname);
    setTab('wallet');
    const sessionId = params.get('Authority') ?? window.localStorage.getItem(PENDING_TOPUP_KEY);
    window.localStorage.removeItem(PENDING_TOPUP_KEY);
    if (params.get('Status') !== 'OK' || !sessionId) {
      setTopupNotice('پرداخت انجام نشد یا لغو شد. مبلغی از حساب شما کسر نشده است؛ اگر کسر شده باشد، درگاه ظرف ۷۲ ساعت آن را بازمی‌گرداند.');
      return;
    }
    if (!getToken()) {
      setTopupNotice('برای ثبت شارژ، ابتدا وارد حساب خود شوید و سپس دوباره تلاش کنید.');
      return;
    }
    setTopupNotice('در حال تأیید پرداخت…');
    api
      .post<{ credited: boolean; balanceToman: number }>('/client/wallet/topup/confirm', { sessionId })
      .then((r) =>
        setTopupNotice(
          r.credited
            ? `کیف پول شارژ شد. موجودی فعلی: ${fa(r.balanceToman)} تومان.`
            : 'این پرداخت قبلاً ثبت شده یا هنوز از سوی درگاه تأیید نشده است.',
        ),
      )
      .catch((e) => setTopupNotice(errText(e)))
      .finally(() => void refresh());
  }, [refresh]);

  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="shell" style={{ maxWidth: 760 }}>
      <header className="topbar">
        <div className="brand">
          <div className="logo">⚖️</div>
          <div>
            <h1>مشاورهٔ حقوقی آنلاین</h1>
            <small>نوبت مشاوره بگیرید و جایگاه خود را در صف ببینید.</small>
          </div>
        </div>
        {token ? (
          <button
            className="btn ghost"
            onClick={() => {
              void signOut();
              setTokenState(null);
              setMe(null);
            }}
          >
            خروج
          </button>
        ) : null}
      </header>

      {installPrompt && (
        <div className="install-banner">
          <span style={{ fontSize: 13 }}>📲 برنامه را روی گوشی نصب کنید تا از نوبت خود بدون باز کردن سایت باخبر شوید.</span>
          <button className="btn primary" onClick={() => void (installPrompt as unknown as { prompt(): void }).prompt()}>
            نصب
          </button>
        </div>
      )}

      {!token ? (
        <OtpCard
          onDone={() => {
            setTokenState(getToken());
            void loadMe();
            void refresh();
          }}
        />
      ) : (
        <>
          <nav className="tabs">
            {(
              [
                ['consult', '🎟️', 'مشاوره'],
                ['wallet', '💰', 'کیف پول'],
                ['inbox', '🔔', 'اعلان‌ها'],
              ] as Array<[TabId, string, string]>
            ).map(([id, icon, label]) => (
              <button key={id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
                <span>{icon}</span>
                <span>{label}</span>
                {id === 'inbox' && unread > 0 && (
                  <span className="pill gold" style={{ fontSize: 10, padding: '1px 7px' }}>
                    {fa(unread)}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {tab === 'consult' && (
            <ConsultTab
              catalog={catalog}
              catalogError={catalogError}
              wallet={wallet}
              position={position}
              telecoms={telecoms}
              purchases={purchases}
              defaultPhone={localPhone(me?.phoneNormalized)}
              refresh={refresh}
              goToWallet={() => setTab('wallet')}
            />
          )}
          {tab === 'wallet' && <WalletTab wallet={wallet} notice={topupNotice} />}
          {tab === 'inbox' && <InboxTab notifications={notifications} refresh={refresh} />}
        </>
      )}

      <footer className="hint" style={{ textAlign: 'center', marginTop: 28, fontSize: 12 }}>
        ساخته‌شده با{' '}
        <a href="https://ansariai.ir" target="_blank" rel="noopener noreferrer">
          پلتفرم حقوقی
        </a>{' '}
        · نرم‌افزار آزاد تحت مجوز AGPL-3.0
      </footer>
    </div>
  );
}

/* ————— sign-in ————— */

function OtpCard({ onDone }: { onDone: () => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function requestCode() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ devCode?: string }>('/auth/otp/request', { phone });
      setDevCode(r.devCode ?? null);
      setSent(true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ accessToken: string; refreshToken?: string }>('/auth/otp/verify', { phone, code });
      setToken(r.accessToken, r.refreshToken);
      onDone();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <h3>ورود یا ثبت‌نام</h3>
        <p className="hint">با شمارهٔ موبایل خود وارد شوید. خریدها و نوبت‌های شما به همین شماره ثبت می‌شود.</p>
        <div className="field">
          <label>شمارهٔ موبایل</label>
          <input
            dir="ltr"
            inputMode="tel"
            value={phone}
            disabled={sent}
            onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="09121234567"
          />
        </div>
        {sent && (
          <div className="field">
            <label>کد تأیید</label>
            <input
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="۶ رقم"
            />
          </div>
        )}
        {devCode && (
          <p className="pill gold" style={{ justifyContent: 'center' }}>
            حالت توسعه: کد تأیید <b dir="ltr">{devCode}</b> است.
          </p>
        )}
        {err && <p className="hint" style={{ color: 'var(--bad)' }}>{err}</p>}
        {!sent ? (
          <button className="btn primary big" disabled={busy || !/^09\d{9}$/.test(phone)} onClick={requestCode}>
            {busy ? '…' : 'ارسال کد'}
          </button>
        ) : (
          <>
            <button className="btn primary big" disabled={busy || code.length < 5} onClick={verify}>
              {busy ? '…' : 'ورود'}
            </button>
            <button
              className="btn ghost"
              style={{ marginTop: 8, width: '100%' }}
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode('');
                setDevCode(null);
              }}
            >
              تغییر شماره
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ————— consultation: plans, queue position ————— */

function ConsultTab({
  catalog,
  catalogError,
  wallet,
  position,
  telecoms,
  purchases,
  defaultPhone,
  refresh,
  goToWallet,
}: {
  catalog: Catalog | null;
  catalogError: boolean;
  wallet: WalletView | null;
  position: QueuePosition | null;
  telecoms: TelecomsView | null;
  purchases: PurchaseView[];
  defaultPhone: string;
  refresh: () => Promise<void>;
  goToWallet: () => void;
}) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!phone && defaultPhone) setPhone(defaultPhone);
  }, [defaultPhone, phone]);

  const phoneOk = /^09\d{9}$/.test(phone);
  const canJoin = !!telecoms?.online && !!telecoms?.queueOpen;
  const unused = purchases.filter((p) => p.kind === 'consultation' && !p.consumed && !p.refunded);

  async function join(purchaseId: string) {
    await api.post('/client/queue/join', { purchaseId, phone });
    setMsg('در صف قرار گرفتید. جایگاه شما در همین صفحه به‌روز می‌شود.');
  }

  async function buyAndJoin(minutes: number) {
    if (busy) return;
    setBusy(`buy${minutes}`);
    setMsg(null);
    try {
      const purchase = await api.post<{ id: string }>('/client/purchases/consultation', { minutes, payWith: 'wallet' });
      try {
        await join(purchase.id);
      } catch (e) {
        setMsg(`خرید ثبت شد، اما ورود به صف انجام نشد: ${errText(e)} می‌توانید بعداً با همین خرید وارد صف شوید.`);
      }
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function joinWithExisting(purchaseId: string) {
    if (busy) return;
    setBusy(purchaseId);
    setMsg(null);
    try {
      await join(purchaseId);
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  async function cancel() {
    if (!position || busy) return;
    if (!window.confirm('نوبت شما لغو و مبلغ آن به کیف پول بازگردانده می‌شود. ادامه می‌دهید؟')) return;
    setBusy('cancel');
    try {
      await api.post(`/client/queue/cancel/${position.ticket.ticketId}`);
      setMsg('نوبت لغو شد و مبلغ آن به کیف پول شما بازگشت.');
    } catch (e) {
      setMsg(errText(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  }

  if (position) {
    const status = position.ticket.status;
    return (
      <div className="grid" style={{ gap: 14 }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <p className="hint" style={{ margin: 0 }}>
            {status === 'up_next' ? '🔔 نوبت شما رسیده است' : status === 'in_call' ? '📞 در حال مشاوره' : 'جایگاه شما در صف'}
          </p>
          <div className="pos-ring">
            <div>
              <div className="num">{status === 'waiting' ? fa(position.position) : status === 'up_next' ? 'شما' : '☎️'}</div>
              {status === 'waiting' && <div className="hint">{fa(position.waitingAhead)} نفر پیش از شما</div>}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap' }}>
            {status === 'waiting' && <span className="pill teal">⏱ زمان تقریبی انتظار: {fa(position.etaMinutes)} دقیقه</span>}
            <span className={`pill ${position.lawyerOnline ? 'ok' : 'bad'}`}>{position.lawyerOnline ? 'وکیل آنلاین است' : 'وکیل آنلاین نیست'}</span>
            <span className="pill">مشاورهٔ {fa(position.ticket.minutes)} دقیقه‌ای</span>
          </div>
          {status === 'waiting' && (
            <button className="btn glass" style={{ marginTop: 14, color: 'var(--bad)' }} disabled={busy !== null} onClick={cancel}>
              لغو نوبت و بازگشت وجه
            </button>
          )}
          {status === 'up_next' && (
            <div className="proposal-card" style={{ marginTop: 14 }}>
              <b>آماده باشید.</b> وکیل به‌زودی با شمارهٔ ثبت‌شده تماس می‌گیرد.
            </div>
          )}
        </div>
        {msg && <p className="pill gold" style={{ justifyContent: 'center' }}>{msg}</p>}
        <p className="hint" style={{ textAlign: 'center', marginTop: 0 }}>
          نزدیک شدن نوبت از طریق اعلان داخل برنامه و، در صورت فعال بودن، پیامک اطلاع داده می‌شود.
        </p>
      </div>
    );
  }

  if (catalogError) {
    return (
      <div className="card">
        <p className="hint">اتصال به سرور برقرار نشد. لطفاً صفحه را دوباره بارگذاری کنید.</p>
      </div>
    );
  }
  if (!catalog) {
    return (
      <div className="card">
        <p className="hint">در حال بارگذاری…</p>
      </div>
    );
  }

  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card" style={{ textAlign: 'center' }}>
        <h2 style={{ margin: '4px 0' }}>مشاورهٔ تلفنی با وکیل</h2>
        <p className="hint">مدت مشاوره را انتخاب کنید. هزینه از کیف پول پرداخت می‌شود و بلافاصله در صف قرار می‌گیرید.</p>
        {wallet && <p className="pill teal">موجودی: {fa(wallet.balanceToman)} تومان</p>}
        {telecoms && !canJoin && (
          <p className="pill bad" style={{ justifyContent: 'center' }}>
            {!telecoms.online
              ? 'وکیل در حال حاضر آنلاین نیست. وقتی آنلاین شود، امکان خرید و ورود به صف فعال می‌شود.'
              : `صف مشاوره در حال حاضر بسته است${telecoms.closeReason ? `: ${telecoms.closeReason}` : '.'}`}
          </p>
        )}
      </div>

      <div className="card">
        <div className="field">
          <label>شماره‌ای که وکیل با آن تماس می‌گیرد</label>
          <input dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ''))} placeholder="09121234567" />
        </div>
        {!phoneOk && phone.length > 0 && <p className="hint" style={{ color: 'var(--bad)' }}>شماره باید ۱۱ رقم و با ۰۹ شروع شود.</p>}
      </div>

      {unused.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>خریدهای استفاده‌نشده</h3>
          {unused.map((p) => (
            <div key={p.id} className="kv">
              <b>مشاورهٔ {fa(p.minutes ?? 0)} دقیقه‌ای</b>
              <button className="btn primary" disabled={busy !== null || !phoneOk || !canJoin} onClick={() => joinWithExisting(p.id)}>
                {busy === p.id ? '…' : 'ورود به صف'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid cols-3">
        {catalog.consultation.map((p) => {
          const short = !wallet || wallet.balanceToman < p.priceToman;
          return (
            <div key={p.minutes} className="card plan-card">
              <div className="minutes">
                {fa(p.minutes)}
                <small> دقیقه</small>
              </div>
              <div className="price">{fa(p.priceToman)} تومان</div>
              {short ? (
                <button className="btn big" onClick={goToWallet}>
                  شارژ کیف پول
                </button>
              ) : (
                <button className="btn primary big" disabled={busy !== null || !phoneOk || !canJoin} onClick={() => buyAndJoin(p.minutes)}>
                  {busy === `buy${p.minutes}` ? '…' : 'خرید و ورود به صف'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {!catalog.consultation.length && <p className="hint">در حال حاضر پلن مشاوره‌ای فعال نیست.</p>}
      {msg && <p className="pill gold" style={{ justifyContent: 'center' }}>{msg}</p>}
    </div>
  );
}

/* ————— wallet ————— */

function WalletTab({ wallet, notice }: { wallet: WalletView | null; notice: string | null }) {
  const [amount, setAmount] = useState('500000');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function topup() {
    const amountToman = Number(amount) || 0;
    if (amountToman < 10_000) {
      setMsg('حداقل مبلغ شارژ ۱۰٬۰۰۰ تومان است.');
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const start = await api.post<{ sessionId: string; redirectUrl: string }>('/client/wallet/topup', { amountToman });
      // The gateway sends the user back to /portal/?topup=return, where the
      // payment is confirmed on the server.
      window.localStorage.setItem(PENDING_TOPUP_KEY, start.sessionId);
      window.location.assign(start.redirectUrl);
    } catch (e) {
      setMsg(errText(e));
      setBusy(false);
    }
  }

  return (
    <div className="grid" style={{ gap: 14 }}>
      {notice && <p className="pill gold" style={{ justifyContent: 'center' }}>{notice}</p>}
      <div className="card" style={{ textAlign: 'center', padding: 30 }}>
        <p className="hint" style={{ margin: 0 }}>موجودی کیف پول</p>
        <div style={{ fontSize: 38, fontWeight: 800, color: 'var(--gold)', margin: '6px 0 14px' }}>
          {fa(wallet?.balanceToman ?? 0)} <small style={{ fontSize: 14 }}>تومان</small>
        </div>
        <label className="hint" htmlFor="topup-amount" style={{ display: 'block', marginBottom: 6 }}>
          مبلغ شارژ (تومان)
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="topup-amount"
            dir="ltr"
            inputMode="numeric"
            style={{ flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line)', borderRadius: 10, padding: 10 }}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ''))}
          />
          <button className="btn primary" disabled={busy} onClick={topup}>
            {busy ? '…' : 'پرداخت و شارژ'}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8, marginBottom: 0 }}>
          به درگاه پرداخت منتقل می‌شوید و پس از پرداخت به همین صفحه بازمی‌گردید.
        </p>
        {msg && <p className="pill gold" style={{ marginTop: 10 }}>{msg}</p>}
      </div>

      <div className="card">
        <h3>تراکنش‌های اخیر</h3>
        {!wallet?.txns.length && <p className="hint">هنوز تراکنشی ثبت نشده است.</p>}
        {wallet?.txns.map((t) => (
          <div key={t.id} className="kv">
            <span>
              <b>{t.note}</b>
              <br />
              <small className="hint">{new Date(t.at).toLocaleString('fa-IR')}</small>
            </span>
            {t.amountToman === 0 ? (
              <span className="pill">پرداخت تأیید نشده</span>
            ) : (
              <span className={t.amountToman > 0 ? 'pill ok' : 'pill bad'}>
                {t.amountToman > 0 ? '+' : '−'}
                {fa(Math.abs(t.amountToman))}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ————— notifications ————— */

function InboxTab({ notifications, refresh }: { notifications: NotificationView[]; refresh: () => Promise<void> }) {
  useEffect(() => {
    const unread = notifications.filter((n) => !n.read).map((n) => n.notificationId);
    if (unread.length) {
      void api
        .post('/client/notifications/read', { notificationIds: unread })
        .then(refresh)
        .catch(() => undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notifications.length]);

  return (
    <div className="grid" style={{ gap: 10 }}>
      {!notifications.length && (
        <div className="card">
          <p className="hint">هنوز اعلانی ندارید. خبر خرید، ورود به صف و نزدیک شدن نوبت در این بخش نمایش داده می‌شود.</p>
        </div>
      )}
      {[...notifications].reverse().map((n) => (
        <div key={n.notificationId} className="card" style={{ opacity: n.read ? 0.75 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>{n.titleFa}</b>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              {n.delivered.sms && <span className="pill teal">پیامک ارسال شد</span>}
              <span className="pill">{new Date(n.at).toLocaleString('fa-IR')}</span>
            </div>
          </div>
          <p className="hint" style={{ marginTop: 6, marginBottom: 0 }}>{n.bodyFa}</p>
        </div>
      ))}
    </div>
  );
}
