'use client';

import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api, type ChatReply } from '@/lib/api';

interface Bubble {
  role: 'you' | 'leader';
  text: string;
  grounded?: boolean;
  proposalId?: string;
  proposalSummary?: string;
  placements?: ChatReply['placements'];
}

export function ChatTab() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>([
    {
      role: 'leader',
      text: 'سلام! من لیدرم 👋\nمی‌تونی هر کاری خواستی بهم بگی:\n• «به مدل محلی وصل شو آدرس http://gpu-box:8080»\n• «تیر سناتور رو فعال کن»\n• یه فایل بفرست تا بخونمش و بگم کجا باید بره\nیا مستقیم سؤال حقوقی‌ات رو بپرس.',
    },
  ]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' });
  }, [bubbles]);

  async function send() {
    const msg = text.trim();
    if (!msg || busy) return;
    setText('');
    setBusy(true);
    setBubbles((b) => [...b, { role: 'you', text: msg }]);
    try {
      let convId = conversationId;
      if (!convId) {
        const conv = await api.post<{ conversationId: string }>('/dashboard/orchestrator/leader/conversations');
        convId = conv.conversationId;
        setConversationId(convId);
      }
      const reply = await api.post<ChatReply>('/dashboard/orchestrator/leader/chat', {
        conversationId: convId,
        text: msg,
      });
      setConversationId(reply.conversationId);
      setBubbles((b) => [
        ...b,
        {
          role: 'leader',
          text: reply.text,
          grounded: reply.grounded,
          proposalId: reply.configProposal?.proposalId,
          proposalSummary: reply.configProposal?.summaryFa,
          placements: reply.placements,
        },
      ]);
    } catch (e) {
      setBubbles((b) => [...b, { role: 'leader', text: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="chatlog" ref={logRef}>
        {bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            <span className="who">{b.role === 'you' ? t('chat.you') : t('chat.leader')}</span>
            {b.text}
            {b.grounded && <div className="badge" style={{ marginTop: 6, display: 'inline-block' }}>📎 {t('chat.grounded')}</div>}
            {b.proposalId && (
              <div className="proposal-card">
                <div style={{ fontSize: 13 }}>{b.proposalSummary}</div>
                <button
                  className="btn primary"
                  style={{ marginTop: 8 }}
                  onClick={async () => {
                    await api.post(`/dashboard/orchestrator/leader/config-proposals/${b.proposalId}/accept`);
                    setBubbles((x) => [
                      ...x,
                      { role: 'leader', text: `انجام شد ✅ ${b.proposalSummary}` },
                    ]);
                  }}
                >
                  {t('chat.confirm')}
                </button>
              </div>
            )}
            {b.placements?.map((p) => (
              <div key={p.fileId} className="placement-card">🗂 {p.suggestion.rationaleFa}</div>
            ))}
          </div>
        ))}
        {busy && <div className="bubble leader"><span className="who">{t('chat.leader')}</span>⏳ دارم فکر می‌کنم…</div>}
      </div>
      <div className="chatbar">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder={t('chat.placeholder')}
        />
        <button className="btn primary" onClick={send} disabled={busy}>
          {t('chat.send')}
        </button>
      </div>
    </div>
  );
}
