'use client';

import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Loader2, Paperclip } from 'lucide-react';
import { RichText } from '@/components/rich-text';
import { t, tx } from '@/i18n';
import { api, type ChatReply } from '@/lib/api';

interface Bubble {
  role: 'you' | 'leader';
  text: string;
  grounded?: boolean;
  proposalId?: string;
  proposalSummary?: string;
  proposalState?: 'pending' | 'applying' | 'applied' | 'failed';
  error?: boolean;
  placements?: ChatReply['placements'];
}

export function ChatTab() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [bubbles, setBubbles] = useState<Bubble[]>(() => [
    {
      role: 'leader',
      text: tx(
        'سلام، دستیار دفتر هستم.\nمی‌توانید پرسش حقوقی بپرسید یا کارها را به زبان ساده بخواهید؛ مثلاً:\n• «شرایط مطالبهٔ مهریه از طریق اجرای ثبت چیست؟»\n• «پیش‌تنظیم حداکثر کیفیت را فعال کن»\n• «زبان رابط را انگلیسی کن»',
        'Hello, I am the office assistant.\nAsk a legal question or describe a task in plain language, for example:\n• “How can mahr be claimed through the registry enforcement office?”\n• “switch to the maximum quality preset”\n• “switch the interface to Persian”',
      ),
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
          proposalState: reply.configProposal ? 'pending' : undefined,
          placements: reply.placements,
        },
      ]);
    } catch (e) {
      setBubbles((b) => [...b, { role: 'leader', error: true, text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  async function accept(index: number, proposalId: string, summary: string | undefined) {
    const setState = (proposalState: Bubble['proposalState']) =>
      setBubbles((x) => x.map((b, i) => (i === index ? { ...b, proposalState } : b)));
    setState('applying');
    try {
      await api.post(`/dashboard/orchestrator/leader/config-proposals/${proposalId}/accept`);
      setState('applied');
      setBubbles((x) => [...x, { role: 'leader', text: tx(`انجام شد: ${summary ?? ''}`, `Done: ${summary ?? ''}`) }]);
    } catch (e) {
      setState('pending');
      setBubbles((x) => [...x, { role: 'leader', error: true, text: e instanceof Error ? e.message : String(e) }]);
    }
  }

  return (
    <div className="card">
      <div className="chatlog" ref={logRef} aria-live="polite">
        {bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.role} ${b.error ? 'error' : ''}`}>
            <span className="who">{b.role === 'you' ? t('chat.you') : t('chat.leader')}</span>
            {b.role === 'leader' ? <RichText text={b.text} /> : b.text}
            {b.grounded && (
              <div className="badge title-row" style={{ marginTop: 6, display: 'inline-flex' }}>
                <Paperclip size={12} aria-hidden="true" />
                {t('chat.grounded')}
              </div>
            )}
            {b.proposalId && (
              <div className="proposal-card">
                <div style={{ fontSize: 13 }}>{b.proposalSummary}</div>
                {b.proposalState === 'applied' ? (
                  <span className="pill ok" style={{ marginTop: 8 }}>{tx('اعمال شد', 'Applied')}</span>
                ) : (
                  <button
                    className="btn primary small"
                    style={{ marginTop: 8 }}
                    disabled={b.proposalState === 'applying'}
                    onClick={() => void accept(i, b.proposalId!, b.proposalSummary)}
                  >
                    {t('chat.confirm')}
                  </button>
                )}
              </div>
            )}
            {b.placements?.map((p) => (
              <div key={p.fileId} className="placement-card title-row">
                <FolderOpen size={14} aria-hidden="true" />
                {p.suggestion.rationaleFa}
              </div>
            ))}
          </div>
        ))}
        {busy && (
          <div className="bubble leader">
            <span className="who">{t('chat.leader')}</span>
            <span className="title-row">
              <Loader2 size={14} className="spin" aria-hidden="true" />
              {tx('در حال آماده‌کردن پاسخ…', 'Preparing a reply…')}
            </span>
          </div>
        )}
      </div>
      <form
        className="chatbar"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <label className="sr-only" htmlFor="chat-input">{t('chat.placeholder')}</label>
        <input id="chat-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={t('chat.placeholder')} autoComplete="off" />
        <button type="submit" className="btn primary" disabled={busy || !text.trim()}>
          {t('chat.send')}
        </button>
      </form>
    </div>
  );
}
