'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowRight, Cpu, FileText, FolderOpen, Fingerprint, LayoutDashboard, Library,
  LogOut, Mail, MessagesSquare, MoreHorizontal, Phone, ShieldCheck, Smartphone, Users,
  type LucideIcon,
} from 'lucide-react';
import { t } from '@/i18n';
import { api, ApiError, getToken, passkeyLogin, setToken, signOut, SIGNED_OUT_EVENT, type BrainView } from '@/lib/api';
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
import { AboutPanel, LegalFooter } from '@/features/about-panel';

type TabId = 'home' | 'brain' | 'fleet' | 'chat' | 'files' | 'kitchen' | 'telecoms' | 'library' | 'drafts' | 'security';

// P10 (Hick's Law): the bar shows the five DAILY desks; everything else sits
  // Less frequent sections live under «بیشتر» (More).
const PRIMARY_TABS: Array<{ id: TabId; icon: LucideIcon }> = [
  { id: 'home', icon: LayoutDashboard },
  { id: 'chat', icon: MessagesSquare },
  { id: 'drafts', icon: FileText },
  { id: 'files', icon: FolderOpen },
];
const MORE_TABS: Array<{ id: TabId; icon: LucideIcon }> = [
  { id: 'kitchen', icon: Activity },
  { id: 'fleet', icon: Users },
  { id: 'brain', icon: Cpu },
  { id: 'library', icon: Library },
  { id: 'telecoms', icon: Phone },
  { id: 'security', icon: ShieldCheck },
];

/** Persian/Arabic-Indic digits → ASCII (phone keyboards in Iran type Persian digits). */
function latinDigits(value: string): string {
  return value.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (ch) =>
    String(ch.charCodeAt(0) - (ch.charCodeAt(0) >= 0x06f0 ? 0x06f0 : 0x0660)),
  );
}

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
  const [aboutOpen, setAboutOpen] = useState(false);

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
    const onSignedOut = () => setTokenState(null);
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    // The setup wizard starts itself on the office's first sign-in.
    if (existing) void refreshBrain();
    setBooting(false);
    return () => window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
  }, [refreshBrain]);

  const signedOut = !booting && !token;

  // Server render and the first client render are both this neutral splash:
  // language, theme and session all live in the browser, so nothing that
  // depends on them is rendered until after mount (no hydration mismatch,
  // no flash of the signed-in shell before the session check).
  if (booting) {
    return (
      <div className="boot" aria-busy="true">
        <img src="/icon.svg" alt="" width={56} height={56} />
      </div>
    );
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/icon.svg" alt="" width={40} height={40} />
          <div>
            <h1>{t('app.name')}</h1>
            <small>{t('app.tagline')}</small>
          </div>
        </div>
        <div className="topbar-actions">
          <UiPrefsBar />
          {token && (
            <button
              className="btn ghost small"
              onClick={() => {
                void signOut();
                setTokenState(null);
              }}
            >
              <LogOut size={16} aria-hidden="true" />
              {t('chrome.logout')}
            </button>
          )}
        </div>
      </header>

      {signedOut ? (
        <LoginCard onDone={(tok) => { setTokenState(tok); void refreshBrain(); }} />
      ) : (
        <>
          <nav className="tabs" aria-label="desks">
            {PRIMARY_TABS.map(({ id, icon: Icon }) => (
              <button
                key={id}
                className={`tab ${tab === id ? 'active' : ''}`}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
              >
                <Icon size={17} aria-hidden="true" />
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
                {(() => {
                  const Icon = MORE_TABS.find((x) => x.id === tab)?.icon ?? MoreHorizontal;
                  return <Icon size={17} aria-hidden="true" />;
                })()}
                <span>{MORE_TABS.find((x) => x.id === tab) ? t(`tab.${tab}` as never) : t('nav.more' as never)}</span>
              </button>
              {moreOpen && (
                <div className="nav-menu" role="menu">
                  {MORE_TABS.map(({ id, icon: Icon }) => (
                    <button
                      key={id}
                      role="menuitem"
                      className={`tab ${tab === id ? 'active' : ''}`}
                      onClick={() => { setTab(id); setMoreOpen(false); }}
                    >
                      <Icon size={17} aria-hidden="true" />
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
      <LegalFooter onAbout={() => setAboutOpen(true)} />
      {aboutOpen && <AboutPanel onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

const OFFICE_ROLES = ['lawyer_owner', 'staff', 'operator'];

function LoginCard({ onDone }: { onDone: (token: string) => void }) {
  const [channel, setChannel] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [challengeSent, setChallengeSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [devToken, setDevToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ challengeId: string; devCode?: string }>(
        channel === 'email' ? '/auth/email-otp/request' : '/auth/otp/request',
        channel === 'email' ? { email: email.trim() } : { phone: latinDigits(phone) },
      );
      setDevCode(r.devCode ?? null);
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
      const body = channel === 'email' ? { email: email.trim(), code: latinDigits(code).trim() } : { phone: latinDigits(phone), code: latinDigits(code).trim() };
      const r = await api.post<{ accessToken: string; refreshToken?: string; user?: { roles?: string[] } }>(channel === 'email' ? '/auth/email-otp/verify' : '/auth/otp/verify', body);
      // The dashboard is for the office; client accounts use the client portal.
      const roles = r.user?.roles ?? [];
      if (!roles.some((role) => OFFICE_ROLES.includes(role))) {
        setErr(t('auth.notOffice'));
        return;
      }
      setToken(r.accessToken, r.refreshToken);
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

  const identifierMissing = channel === 'email' ? !email.trim() : !phone.trim();

  return (
    <div className="auth-wrap">
      <form
        className="card auth-card"
        onSubmit={(ev) => {
          ev.preventDefault();
          if (busy) return;
          if (!challengeSent) {
            if (!identifierMissing) void requestOtp();
          } else if (code.trim()) {
            void verify();
          }
        }}
      >
        <h3>{t('auth.title')}</h3>
        <p className="hint">{t('auth.hint')}</p>
        <div className="segmented" role="tablist" aria-label={t('auth.hint')}>
          {(['phone', 'email'] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              className={`tab ${channel === c ? 'active' : ''}`}
              onClick={() => { setChannel(c); setChallengeSent(false); setCode(''); setErr(null); setDevCode(null); }}
            >
              {c === 'phone' ? <Smartphone size={16} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}
              {t(`auth.channel.${c}` as never)}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="login-id">{channel === 'email' ? t('auth.email' as never) : t('auth.phone')}</label>
          {channel === 'email' ? (
            <input
              id="login-id"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vakil@example.com"
              dir="ltr"
              inputMode="email"
              autoComplete="email"
              readOnly={challengeSent}
            />
          ) : (
            <input
              id="login-id"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09XXXXXXXXX"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              readOnly={challengeSent}
            />
          )}
        </div>
        {challengeSent && (
          <div className="field">
            <label htmlFor="login-code">{t('auth.otp')}</label>
            <input
              id="login-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              autoFocus
            />
            {devCode && (
              <p className="hint">
                {t('auth.devCode')} <b dir="ltr">{devCode}</b>
              </p>
            )}
          </div>
        )}
        {err && <p className="form-error" role="alert">{err}</p>}
        <button type="submit" className="btn primary big" disabled={busy || (challengeSent ? !code.trim() : identifierMissing)}>
          {!challengeSent
            ? channel === 'email' ? t('auth.sendEmailOtp' as never) : t('auth.sendOtp')
            : t('auth.verify')}
        </button>
        {challengeSent && (
          <button
            type="button"
            className="btn ghost link-btn"
            onClick={() => { setChallengeSent(false); setCode(''); setErr(null); setDevCode(null); }}
          >
            <ArrowRight size={15} aria-hidden="true" className="flip-ltr" />
            {channel === 'email' ? t('auth.changeEmail' as never) : t('auth.changePhone' as never)}
          </button>
        )}

        {/* Passkey sign-in (fingerprint or face instead of a text message) */}
        <button
          type="button"
          className="btn ghost big auth-passkey"
          disabled={busy || identifierMissing}
          onClick={async () => {
            setBusy(true); setErr(null);
            try {
              await passkeyLogin(channel === 'email' ? email.trim() : latinDigits(phone));
              const tok = getToken() ?? '';
              if (tok) onDone(tok);
            } catch (e) {
              setErr(errText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Fingerprint size={18} aria-hidden="true" />
          {t('auth.passkey')}
        </button>
        {process.env.NODE_ENV !== 'production' && (
        <div className="dev-notice">
          {t('auth.devToken')}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <input
              style={{ flex: 1, background: 'rgba(0,0,0,.3)', border: '1px solid var(--line)', borderRadius: 8, padding: 8, direction: 'ltr' }}
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
              placeholder="DEV_DASHBOARD_TOKEN"
            />
            <button type="button" className="btn" onClick={devLogin}>{t('auth.devLogin')}</button>
          </div>
        </div>
        )}
      </form>
    </div>
  );
}

function errText(e: unknown): string {
  // ApiError already carries a translated message; anything else is a network failure.
  return e instanceof ApiError ? e.message : t('auth.connError');
}
