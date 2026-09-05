'use client';

import { t } from '@/i18n';
import type { BrainView } from '@/lib/api';

const TIER_ICON: Record<string, string> = { spartan: '🟢', counsel: '🟡', senator: '🔴' };
const TIER_FA: Record<string, string> = { spartan: 'اسپارتان', counsel: 'کانسل', senator: 'سناتور' };

export function HomeTab({ brain, goTab }: { brain: BrainView | null; goTab: (t: 'brain' | 'chat' | 'kitchen' | 'fleet' | 'files' | 'home') => void }) {
  return (
    <div className="grid" style={{ gap: 18 }}>
      <div className="card" style={{ textAlign: 'center', padding: 34 }}>
        <h2 style={{ marginTop: 0 }}>{t('home.title')}</h2>
        <p className="hint" style={{ maxWidth: 560, margin: '0 auto' }}>
          {brain?.lendingScenario ?? '…در حال خواندن وضعیت'}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <span className="pill gold">{TIER_ICON[brain?.preset ?? 'counsel']} {t('home.preset')}: {TIER_FA[brain?.preset ?? 'counsel']}</span>
          <span className="pill teal">{t('home.policy')}: {brain?.effectivePolicy ?? '—'}</span>
          <span className={`pill ${brain?.local.baseUrl || brain?.cloud.apiKeyMasked ? 'ok' : 'bad'}`}>
            {brain?.local.baseUrl || brain?.cloud.apiKeyMasked ? 'مغز وصل است' : 'مغز وصل نیست'}
          </span>
        </div>
      </div>

      <div className="grid cols-3">
        <Jump emoji="🧠" title={t('tab.brain')} body="آدرس مدل محلی یا کلید ابری را بچسبان — لیدر همان لحظه با مغز تازه کار می‌کند." onClick={() => goTab('brain')} />
        <Jump emoji="💬" title={t('tab.chat')} body="با لیدر حرف بزن؛ فایل بفرست؛ بگو چه کاری انجام دهد — حتی کانفیگ پلتفرم." onClick={() => goTab('chat')} />
        <Jump emoji="🍳" title={t('tab.kitchen')} body="کارِ ایجنت‌ها را زنده ببین: کدام ایجنت، کدام مهارت، روی کدام مغز." onClick={() => goTab('kitchen')} />
        <Jump emoji="👥" title={t('tab.fleet')} body="کارتِ شخصی هر کارشناس: مهارت‌ها، سلامت، گرنت‌های فعال." onClick={() => goTab('fleet')} />
        <Jump emoji="📁" title={t('tab.files')} body="فایل بریز؛ لیدر اول می‌خواند، بعد جواب می‌دهد و می‌گوید کجا بگذاردش." onClick={() => goTab('files')} />
      </div>
    </div>
  );
}

function Jump({ emoji, title, body, onClick }: { emoji: string; title: string; body: string; onClick: () => void }) {
  return (
    <button className="card" style={{ textAlign: 'right', cursor: 'pointer' }} onClick={onClick}>
      <div style={{ fontSize: 28 }}>{emoji}</div>
      <h3 style={{ marginTop: 8 }}>{title}</h3>
      <p className="hint">{body}</p>
    </button>
  );
}
