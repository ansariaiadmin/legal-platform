'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentIcon } from '@/components/agent-icon';
import { getPrefs, t, tx } from '@/i18n';
import { api, getToken, type AgentEventMsg, type FleetAgent } from '@/lib/api';

/**
 * THE CREATIVE PIECE (ADR-014 + ADR-006): the society's factory floor.
 * Agents are orbs — the Leader glows center-left — and every SSE event
 * becomes a flying packet you can FOLLOW with your eyes: yellow = task
 * arrives, violet = a brain was chosen, teal = a skill is cooking,
 * green = served. What the fleet does is no longer a log line; you SEE it.
 */

/** Event kind → [Persian, English] label. */
const KIND_LABEL: Record<string, [string, string]> = {
  'task.accepted': ['درخواست دریافت شد', 'Request received'],
  'task.classified': ['دسته‌بندی شد', 'Classified'],
  'task.routed': ['به دستیار سپرده شد', 'Assigned to an assistant'],
  'inference.decided': ['مدل انتخاب شد', 'Model chosen'],
  'skill.started': ['اجرای مهارت آغاز شد', 'Skill started'],
  'skill.completed': ['اجرای مهارت پایان یافت', 'Skill finished'],
  'task.completed': ['انجام شد', 'Done'],
  'task.failed': ['ناموفق', 'Failed'],
  'grant.issued': ['مجوز صادر شد', 'Permission granted'],
  'grant.revoked': ['مجوز لغو شد', 'Permission revoked'],
  'model.assigned': ['مدل اختصاص یافت', 'Model assigned'],
  'model.unassigned': ['اختصاص مدل برداشته شد', 'Model unassigned'],
  'file.uploaded': ['فایل بارگذاری شد', 'File uploaded'],
  'file.analyzed': ['فایل بررسی شد', 'File analysed'],
  'conversation.turn': ['پیام گفت‌وگو', 'Conversation message'],
};

interface Packet {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  tone: 'task' | 'inference' | 'done';
  born: number;
}

let packetSeq = 1;

export function KitchenTab() {
  const [agents, setAgents] = useState<Array<{ id: string; persona: string; personaEn: string | null }>>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [events, setEvents] = useState<AgentEventMsg[]>([]);
  const [packets, setPackets] = useState<Packet[]>([]);
  const [live, setLive] = useState(false);
  const timeouts = useRef<number[]>([]);

  // fleet roster (positions are computed from it, so spawned agents appear too)
  useEffect(() => {
    void (async () => {
      try {
        const fleet = await api.get<{ agents: FleetAgent[] }>('/dashboard/orchestrator/fleet');
        setAgents(
          fleet.agents.map((a) => ({
            id: a.agentId,
            persona: a.persona,
            personaEn: a.personaEn ?? null,
          })),
        );
      } catch {
        /* roster fetch needs auth — floor still animates on events */
      }
    })();
  }, []);

  const agentName = (id: string | null | undefined): string => {
    if (!id) return tx('دستیار اصلی', 'Lead assistant');
    if (id === 'legal-leader') return tx('دستیار اصلی', 'Lead assistant');
    const a = agents.find((x) => x.id === id);
    if (!a) return tx('دستیار تخصصی', 'Specialist assistant');
    return getPrefs().locale === 'en' && a.personaEn ? a.personaEn : a.persona;
  };

  const pos = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    map.set('legal-leader', { x: 22, y: 50 });
    const specialists = agents;
    specialists.forEach((a, i) => {
      const col = 55 + 27 * ((i % 2) ^ 1); // stagger
      const row = 14 + i * (specialists.length > 1 ? 72 / (specialists.length - 1) || 0 : 0);
      map.set(a.id, { x: col, y: row });
    });
    return map;
  }, [agents]);

  // ---- SSE subscription ----------------------------------------------------
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let es: EventSource | null = null;
    let stopped = false;

    async function open() {
      try {
        const recent = await api.get<{ events: AgentEventMsg[] }>('/dashboard/orchestrator/events/recent');
        setEvents(recent.events.slice(-8));
      } catch { /* fine */ }
      // FIELD REVIEW #4: never carry the 60-minute bearer in the URL. Mint a
      // single-use 45-second ticket with the real Authorization header (the
      // tunnel forwards it) — the URL credential dies before logs get read.
      let ticket = '';
      try {
        const minted = await api.post<{ ticket: string; expiresInSec: number }>(
          '/dashboard/orchestrator/events/stream-ticket',
        );
        ticket = minted.ticket;
      } catch { /* no stream without a ticket — the reconnect loop below retries */ }
      if (!ticket || stopped) return;
      es = new EventSource(`/stream/events?ticket=${encodeURIComponent(ticket)}`);
      es.onopen = () => setLive(true);
      es.onerror = () => {
        setLive(false);
        if (!stopped) {
          es?.close();
          const t = window.setTimeout(open, 4000);
          timeouts.current.push(t);
        }
      };
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as AgentEventMsg;
          handleEvent(ev);
        } catch { /* partial chunk */ }
      };
    }
    void open();
    return () => {
      stopped = true;
      es?.close();
      for (const t of timeouts.current) window.clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos]);

  function fly(from: { x: number; y: number }, to: { x: number; y: number }, tone: Packet['tone']) {
    const id = packetSeq++;
    setPackets((ps) => [...ps, { id, from, to, tone, born: Date.now() }]);
    const t = window.setTimeout(() => setPackets((ps) => ps.filter((p) => p.id !== id)), 1300);
    timeouts.current.push(t);
  }

  function handleEvent(ev: AgentEventMsg) {
    setEvents((es) => [...es.slice(-29), ev]);
    const leader = pos.get('legal-leader') ?? { x: 22, y: 50 };
    const target = ev.agentId ? pos.get(ev.agentId) : undefined;

    switch (ev.kind) {
      case 'task.accepted':
        fly({ x: 6, y: 6 }, leader, 'task');
        break;
      case 'task.routed':
      case 'task.classified':
        if (target) fly(leader, target, 'task');
        break;
      case 'inference.decided':
        if (target) fly(leader, target, 'inference');
        break;
      case 'skill.started':
        if (ev.agentId) setBusyIds((s) => new Set(s).add(ev.agentId!));
        break;
      case 'skill.completed':
        if (ev.agentId) {
          setBusyIds((s) => {
            const n = new Set(s);
            n.delete(ev.agentId!);
            return n;
          });
          if (target) fly(target, leader, 'done');
        }
        break;
      case 'task.completed':
      case 'task.failed':
        if (target) fly(target, leader, 'done');
        break;
      case 'file.uploaded':
      case 'file.analyzed':
      case 'conversation.turn':
        fly({ x: 10, y: 92 }, leader, 'task');
        break;
      default:
        break;
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 2px' }}>{t('kitchen.title')}</h2>
          <p className="hint" style={{ margin: 0 }}>{t('kitchen.subtitle')}</p>
        </div>
        <span className={`pill ${live ? 'ok' : 'bad'}`}>{live ? tx('زنده', 'Live') : tx('در حال اتصال…', 'Connecting…')}</span>
      </div>

      <div className="floor">
        {/* leader */}
        <div className="node leader" style={{ left: `${pos.get('legal-leader')!.x}%`, top: `${pos.get('legal-leader')!.y}%` }}>
          <div className="orb"><AgentIcon agentId="legal-leader" size={26} /><i className="heat" /></div>
          <div className="name">{tx('دستیار اصلی', 'Lead assistant')}</div>
          <div className="sub">{tx('هماهنگ‌کنندهٔ دستیاران', 'Coordinates the experts')}</div>
        </div>
        {/* experts */}
        {agents.map((a) => {
          const p = pos.get(a.id)!;
          return (
            <div key={a.id} className={`node ${busyIds.has(a.id) ? 'working' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <div className="orb"><AgentIcon agentId={a.id} /><i className="heat" /></div>
              <div className="name">{getPrefs().locale === 'en' && a.personaEn ? a.personaEn : a.persona}</div>
            </div>
          );
        })}
        {/* flying packets */}
        {packets.map((p) => (
          <FlyingPacket key={p.id} packet={p} />
        ))}
      </div>

      <div className="ticker">
        {events.length === 0 && <p className="hint">{t('kitchen.waiting')}</p>}
        {events.slice().reverse().map((ev, i) => (
          <div key={`${ev.at}-${i}`} className="ev" title={ev.detail ?? undefined}>
            <span className="k">{KIND_LABEL[ev.kind] ? tx(...KIND_LABEL[ev.kind]) : tx('رویداد سامانه', 'System event')}</span>
            <span style={{ flex: 1 }}>
              {agentName(ev.agentId)}
              {ev.model ? <> · <span dir="ltr">{ev.model}</span></> : null}
            </span>
            {ev.assignmentSource && <span className="badge">{ev.assignmentSource === 'leader_fallback'
              ? tx('مدل دستیار اصلی', 'Lead assistant’s model')
              : ev.assignmentSource === 'manual'
                ? tx('مدل اختصاصی', 'Dedicated model')
                : tx('انتخاب خودکار', 'Automatic choice')}</span>}
            <time>{new Date(ev.at).toLocaleTimeString(getPrefs().locale === 'fa' ? 'fa-IR' : 'en-GB')}</time>
          </div>
        ))}
      </div>
    </div>
  );
}

function FlyingPacket({ packet }: { packet: Packet }) {
  const [at, setAt] = useState(packet.from);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setAt(packet.to));
    return () => cancelAnimationFrame(raf);
  }, [packet.to]);
  return (
    <div
      className={`packet ${packet.tone === 'inference' ? 'inference' : packet.tone === 'done' ? 'done' : ''}`}
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    />
  );
}
