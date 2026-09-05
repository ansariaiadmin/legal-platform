'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '@/i18n';
import { api, getToken, type AgentEventMsg, type FleetAgent } from '@/lib/api';

/**
 * THE CREATIVE PIECE (ADR-014 + ADR-006): the society's factory floor.
 * Agents are orbs — the Leader glows center-left — and every SSE event
 * becomes a flying packet you can FOLLOW with your eyes: yellow = task
 * arrives, violet = a brain was chosen, teal = a skill is cooking,
 * green = served. What the fleet does is no longer a log line; you SEE it.
 */

const KIND_FA: Record<string, string> = {
  'task.accepted': 'تَسک پذیرفته شد',
  'task.classified': 'دسته‌بندی شد',
  'task.routed': 'روت شد',
  'inference.decided': 'مغز انتخاب شد',
  'skill.started': 'مهارت شروع به کار کرد',
  'skill.completed': 'مهارت تمام شد',
  'task.completed': 'سِرو شد',
  'task.failed': 'ناموفق',
  'grant.issued': 'گرنت صادر شد',
  'grant.revoked': 'گرنت باطل شد',
  'model.assigned': 'مغز سپرده شد',
  'model.unassigned': 'مغز پس گرفته شد',
  'file.uploaded': 'فایل رسید',
  'file.analyzed': 'فایل خوانده شد',
  'conversation.turn': 'نوبت گفت‌وگو',
};

const CACHE: Record<string, string> = {
  'civil-expert': '📜',
  'criminal-expert': '⚔️',
  'family-expert': '👨‍👩‍👧',
  'registration-expert': '🖋️',
  'legal-expert-base': '🧭',
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
  const [agents, setAgents] = useState<Array<{ id: string; persona: string; emoji: string }>>([]);
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
            emoji: CACHE[a.agentId] ?? '✨',
          })),
        );
      } catch {
        /* roster fetch needs auth — floor still animates on events */
      }
    })();
  }, []);

  const pos = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    map.set('legal-leader', { x: 22, y: 50 });
    const specialists = agents.filter((a) => a.id !== 'legal-expert-base');
    const general = agents.find((a) => a.id === 'legal-expert-base');
    specialists.forEach((a, i) => {
      const col = 55 + 27 * ((i % 2) ^ 1); // stagger
      const row = 14 + i * (specialists.length > 1 ? 72 / (specialists.length - 1) || 0 : 0);
      map.set(a.id, { x: col, y: row });
    });
    if (general) map.set(general.id, { x: 69, y: 92 });
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
      es = new EventSource(`/stream/events?token=${encodeURIComponent(getToken() ?? '')}`);
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
          <h2 style={{ margin: '0 0 2px' }}>{t('kitchen.title')} 🍳</h2>
          <p className="hint" style={{ margin: 0 }}>{t('kitchen.subtitle')}</p>
        </div>
        <span className={`pill ${live ? 'ok' : 'bad'}`}>{live ? '● زنده' : '○ در حال اتصال…'}</span>
      </div>

      <div className="floor">
        {/* leader */}
        <div className="node leader" style={{ left: `${pos.get('legal-leader')!.x}%`, top: `${pos.get('legal-leader')!.y}%` }}>
          <div className="orb">👑<i className="heat" /></div>
          <div className="name">لیدر</div>
          <div className="sub">مدیر جامعه</div>
        </div>
        {/* experts */}
        {agents.map((a) => {
          const p = pos.get(a.id)!;
          return (
            <div key={a.id} className={`node ${busyIds.has(a.id) ? 'working' : ''}`} style={{ left: `${p.x}%`, top: `${p.y}%` }}>
              <div className="orb">{a.emoji}<i className="heat" /></div>
              <div className="name">{a.persona}</div>
              <div className="sub">{a.id}</div>
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
          <div key={`${ev.at}-${i}`} className="ev">
            <span className="k">{KIND_FA[ev.kind] ?? ev.kind}</span>
            <span style={{ flex: 1 }}>
              {ev.agentId ?? '—'}
              {ev.model ? ` · ${ev.model}` : ''}
              {ev.detail ? ` · ${ev.detail}` : ''}
            </span>
            {ev.assignmentSource && <span className="badge">{ev.assignmentSource === 'leader_fallback' ? 'قرض از لیدر' : ev.assignmentSource}</span>}
            <time>{new Date(ev.at).toLocaleTimeString('fa-IR')}</time>
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
