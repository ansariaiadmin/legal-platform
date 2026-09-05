'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api, getToken, setToken, type BrainView } from '@/lib/api';
import { HomeTab } from '@/features/home-tab';
import { BrainTab } from '@/features/connect-brain-tab';
import { FleetTab } from '@/features/fleet-tab';
import { ChatTab } from '@/features/leader-chat-tab';
import { FilesTab } from '@/features/files-tab';
import { KitchenTab } from '@/features/kitchen-tab';
import { TelecomsTab } from '@/features/telecoms-tab';
import { LibraryTab } from '@/features/library-tab';
import { DraftsTab } from '@/features/drafts-tab';
import { SecurityTab } from '@/features/security-tab';
import { Tour } from '@/features/tour';
import { UiPrefsBar } from '@/features/ui-prefs-bar';
import { SetupWizardOverlay } from '@/features/setup-wizard';

type TabId = 'home' | 'brain' | 'fleet' | 'chat' | 'files' | 'kitchen' | 'telecoms' | 'library' | 'drafts' | 'security';

// P10 (Hick's Law): the bar shows the five DAILY desks; everything else sits
// one tap behind «بیشتر» — decision time drops, zero powers removed.
const PRIMARY_TABS: Array<{ id: TabId; icon: string }> = [
  { id: 'home', icon: '🏠' },
  { id: 'chat', icon: '💬' },
  { id: 'drafts', icon: '✍️' },
  { id: 'files', icon: '📁' },
];
const MORE_TABS: Array<{ id: TabId; icon: string }> = [
  { id: 'kitchen', icon: '🍳' },
  { id: 'fleet', icon: '👥' },
  { id: 'brain', icon: '🧠' },
  { id: 'library', icon: '📚' },
  { id: 'telecoms', icon: '📞' },
  { id: 'security', icon: '🛡️' },
];

export default function Dashboard() {
  // Tail of file's logic follows; hooks for ui prefs live in UiPrefsBar —
  // the dashboard just hosts it globally so language/theme flips ripple
  // everywhere without prop drilling.
  const [tab, setTab] = useState<TabId>('home');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const [token, setTokenState] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainView | null>(null);
  const [booting, setBooting] = useState(true);

  // close the overflow menu on outside tap / Escape — invisible focus traps
  // are the quiet killer of trust
  useEffect(() => {
    if (!moreOpen) return;
    const onDoc = (ev: MouseEvent) => {
      if (!moreRef.current?.contains(ev.target as Node)) setMoreOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') setMoreOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [moreOpen]);

  const refreshBrain = useCallback(async () => {
    try {
      setBrain(await api.get<BrainView>('/dashboard/config/brain'));
    } catch {
      setBrain(null);
    }
  }, []);

  useEffect(() => {
    const existing = getToken();
    setTokenState(existing);
    if (existing) {
      void refreshBrain();
      // P8: first login ever → step into the wizard (server marks it idempotent)
      api
        .get<{ started: boolean }>('/dashboard/setup')
        .then(async (s) => {
          if (!s.started) await api.post('/dashboard/setup/start', {});
        })
        .catch(() => undefined);
    }
    setBooting(false);
  }, [refreshBrain]);

  const signedOut = !booting && !token;

  return (
    <div className="shell">
      <header className="topbar">
        <UiPrefsBar />
        <div className="brand">
          <div className="logo">⚖️</div>
          <div>
            <h1>{t('app.name')}</h1>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        {token && (
          <button
            className="btn ghost"
            onClick={() => {
              setToken(null);
              setTokenState(null);
            }}
          >
            خروج
          </button>
        )}
      </header>

      {signedOut ? (
        <LoginCard onDone={(tok) => { setTokenState(tok); void refreshBrain(); }} />
      ) : (
        <>
          <nav className="tabs" aria-label="desks">
            {PRIMARY_TABS.map(({ id, icon }) => (
              <button
                key={id}
                className={`tab ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                <span className="tab-icon">{icon}</span>
                <span>{t(`tab.${id}` as never)}</span>
              </button>
            ))}
            <div className="nav-more" ref={moreRef}>
              <button
                className={`tab ${MORE_TABS.some((x) => x.id === tab) ? 'active' : ''}`}
                onClick={() => setMoreOpen((v) => !v)}
                aria-expanded={moreOpen}
                aria-haspopup="menu"
              >
                <span className="tab-icon">{MORE_TABS.find((x) => x.id === tab)?.icon ?? '⋯'}</span>
                <span>{MORE_TABS.find((x) => x.id === tab) ? t(`tab.${tab}` as never) : t('nav.more' as never)}</span>
              </button>
              {moreOpen && (
                <div className="nav-menu" role="menu">
                  {MORE_TABS.map(({ id, icon }) => (
                    <button
                      key={id}
                      role="menuitem"
                      className={`tab ${tab === id ? 'active' : ''}`}
                      onClick={() => { setTab(id); setMoreOpen(false); }}
                    >
                      <span className="tab-icon">{icon}</span>
                      <span>{t(`tab.${id}` as never)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </nav>

          {tab === 'home' && <HomeTab brain={brain} goTab={setTab} />}
          {tab === 'brain' && <BrainTab brain={brain} onChanged={refreshBrain} />}
          {tab === 'fleet' && <FleetTab />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'files' && <FilesTab />}
          {tab === 'kitchen' && <KitchenTab />}
          {tab === 'telecoms' && <TelecomsTab />}
          {tab === 'library' && <LibraryTab />}
          {tab === 'drafts' && <DraftsTab />}
          {tab === 'security' && <SecurityTab />}
          <SetupWizardOverlay onNavigate={(id) => setTab(id as TabId)} />
          <Tour activeTab={tab} onNavigate={(id) => setTab(id as TabId)} />
        </>
      )}
    </div>
  );
}

function LoginCard({ onDone }: { onDone: (token: string) => void }) {
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeSent, setChallengeSent] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    setBusy(true); setErr(null);
    try {
      // P10: one honest switch — same 6-digit math, either channel
      await api.post(channel === 'email' ? '/auth/email-otp/request' : '/auth/otp/request', channel === 'email' ? { email } : { phone });
      setChallengeSent(true);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    setBusy(true); setErr(null);
    try {
      const body = channel === 'email' ? { email, code } : { phone, code };
      const r = await api.post<{ accessToken: string }>(channel === 'email' ? '/auth/email-otp/verify' : '/auth/otp/verify', body);
      setToken(r.accessToken);
      onDone(r.accessToken);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  }

  function devLogin() {
    if (!devToken.trim()) return;
    setToken(devToken.trim());
    onDone(devToken.trim());
  }

  return (
    <div className="auth-wrap">
      <div className="card">
        <h3>{t('auth.title')}</h3>
        <p className="hint">با موبایل وارد شو — در محیط سندباکس از توکن توسعه‌گر استفاده کن.</p>
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} role="tablist" aria-label="login channel">
          {(['phone', 'email'] as const).map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={channel === c}
              className={`tab ${channel === c ? 'active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => { setChannel(c); setChallengeSent(false); setCode(''); }}
            >
              {c === 'phone' ? '📱' : '✉️'} {t(`auth.channel.${c}` as never)}
            </button>
          ))}
        </div>
        <div className="field">
          <label>{channel === 'email' ? t('auth.email' as never) : t('auth.phone')}</label>
          {channel === 'email' ? (
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vakil@example.com"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
            />
          ) : (
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0912..."
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
            />
          )}
        </div>
        {challengeSent && (
          <div className="field">
            <label>{t('auth.otp')}</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
          </div>
        )}
        {err && <p className="hint" style={{ color: 'var(--bad)' }}>{err}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          {!challengeSent ? (
            <button className="btn primary big" disabled={busy || (channel === 'email' ? !email : !phone)} onClick={requestOtp}>
              {channel === 'email' ? t('auth.sendEmailOtp' as never) : t('auth.sendOtp')}
            </button>
          ) : (
            <button className="btn primary big" disabled={busy || !code} onClick={verify}>
              {t('auth.verify')}
            </button>
          )}
        </div>
        <div className="dev-notice">
          {t('auth.devToken')}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={{ flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, direction: 'ltr' }}
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
              placeholder="DEV_DASHBOARD_TOKEN"
            />
            <button className="btn" onClick={devLogin}>{t('auth.devLogin')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function errText(e: unknown): string {
  const b = (e as { body?: { message?: string } }).body?.message;
  return typeof b === 'string' ? b : 'خطا در اتصال — آیا API بالاست؟';
}
