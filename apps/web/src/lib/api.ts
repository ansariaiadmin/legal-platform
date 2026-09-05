/**
 * Browser → our SAME-ORIGIN Next proxy (/api/*) → the API service inside the
 * sandbox. The browser NEVER talks to 127.0.0.1 directly (preview hosts live
 * outside the sandbox); the rewrite map in next.config.js does the plumbing.
 */

export const TOKEN_KEY = 'lp_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

const AREA_TICKETS_KEY = 'lp_area_tickets';

/** P8 area tickets: per-area HMAC tickets (12h) the unlock dialog mints. */
export function getAreaTicket(area: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(AREA_TICKETS_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, { ticket: string; expiresAt: string }>) : {};
    const rec = map[area];
    if (!rec || Date.parse(rec.expiresAt) <= Date.now()) return null;
    return rec.ticket;
  } catch {
    return null;
  }
}

export function setAreaTicket(area: string, rec: { ticket: string; expiresAt: string } | null) {
  if (typeof window === 'undefined') return;
  let map: Record<string, { ticket: string; expiresAt: string }> = {};
  try {
    const raw = window.localStorage.getItem(AREA_TICKETS_KEY);
    map = raw ? (JSON.parse(raw) as typeof map) : {};
  } catch { /* corrupt → start fresh */ }
  if (rec) map[area] = rec;
  else delete map[area];
  window.localStorage.setItem(AREA_TICKETS_KEY, JSON.stringify(map));
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  // locked-area calls carry the ticket automatically — one CPU cycle of UX
  for (const area of ['config', 'vault', 'ops']) {
    if (path.includes(`/dashboard/${area}`)) {
      const ticket = getAreaTicket(area);
      if (ticket) headers['X-Area-Ticket'] = ticket;
    }
  }
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) {
      payload = body as FormData;
    } else {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  postForm: <T>(path: string, form: FormData) => request<T>('POST', path, form, true),
  delete: <T>(path: string) => request<T>('DELETE', path),
};

// ---------------- shared response shapes (mirrors apps/api DTOs) ----------

export interface BrainView {
  local: { baseUrl: string | null; model: string | null; source: 'env' | 'runtime' | 'none' };
  cloud: { baseUrl: string | null; model: string | null; apiKeyMasked: string | null; source: 'env' | 'runtime' | 'none' };
  preset: 'spartan' | 'counsel' | 'senator';
  effectivePolicy: string;
  lendingScenario: string;
}

export interface FleetAgent {
  agentId: string;
  field: string;
  persona: string;
  personaEn: string | null;
  mottoEn: string | null;
  motto: string;
  skills: string[];
  healthy: boolean;
  kind: string;
  disabled: boolean;
  activeGrants: number;
}

export interface AgentEventMsg {
  kind: string;
  at: string;
  taskId: string;
  agentId: string | null;
  model?: string;
  assignmentSource?: string;
  detail?: string;
}

export interface ChatReply {
  conversationId: string;
  text: string;
  placements: Array<{
    fileId: string;
    filename: string;
    suggestion: { agentId: string | null; collection: string; rationaleFa: string };
  }>;
  routing: { agentId: string | null; skillId: string | null; confidence: number };
  grounded: boolean;
  configProposal?: { proposalId: string; summaryFa: string };
  configApplied?: { kind: string; summaryFa: string };
}

export interface FileRecordView {
  fileId: string;
  filename: string;
  mimetype: string;
  size: number;
  analysis: {
    status: string;
    kindGuess?: string;
    chars?: number;
    needsOcr?: boolean;
    preview?: string;
    languageHint?: string;
  } | null;
}
