'use client';

import { useCallback, useEffect, useState } from 'react';
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

type TabId = 'home' | 'brain' | 'fleet' | 'chat' | 'files' | 'kitchen' | 'telecoms' | 'library';

const TABS: Array<{ id: TabId; icon: string }> = [
  { id: 'home', icon: '🏠' },
  { id: 'brain', icon: '🧠' },
  { id: 'fleet', icon: '👥' },
  { id: 'chat', icon: '💬' },
  { id: 'files', icon: '📁' },
  { id: 'kitchen', icon: '🍳' },
  { id: 'telecoms', icon: '📞' },
  { id: 'library', icon: '📚' },
];

export default function Dashboard() {
  const [tab, setTab] = useState<TabId>('home');
  const [token, setTokenState] = useState<string | null>(null);
  const [brain, setBrain] = useState<BrainView | null>(null);
  const [booting, setBooting] = useState(true);

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
    if (existing) void refreshBrain();
    setBooting(false);
  }, [refreshBrain]);

  const signedOut = !booting && !token;

  return (
    <div className="shell">
      <header className="topbar">
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
          <nav className="tabs">
            {TABS.map(({ id, icon }) => (
              <button
                key={id}
                className={`tab ${tab === id ? 'active' : ''}`}
                onClick={() => setTab(id)}
              >
                <span>{icon}</span>
                <span>{t(`tab.${id}` as never)}</span>
              </button>
            ))}
          </nav>

          {tab === 'home' && <HomeTab brain={brain} goTab={setTab} />}
          {tab === 'brain' && <BrainTab brain={brain} onChanged={refreshBrain} />}
          {tab === 'fleet' && <FleetTab />}
          {tab === 'chat' && <ChatTab />}
          {tab === 'files' && <FilesTab />}
          {tab === 'kitchen' && <KitchenTab />}
          {tab === 'telecoms' && <TelecomsTab />}
          {tab === 'library' && <LibraryTab />}
        </>
      )}
    </div>
  );
}

function LoginCard({ onDone }: { onDone: (token: string) => void }) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeSent, setChallengeSent] = useState(false);
  const [devToken, setDevToken] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestOtp() {
    setBusy(true); setErr(null);
    try {
      await api.post('/auth/otp/request', { phone });
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
      const r = await api.post<{ accessToken: string }>('/auth/otp/verify', { phone, code });
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
        <div className="field">
          <label>{t('auth.phone')}</label>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="0912..."
            dir="ltr"
          />
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
            <button className="btn primary big" disabled={busy || !phone} onClick={requestOtp}>
              {t('auth.sendOtp')}
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
