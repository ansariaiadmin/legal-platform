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

// ---------------- client-side response shapes (P2a) ----------

export interface ConsultationPlanView {
  minutes: 10 | 20 | 30;
  priceToman: number;
  active: boolean;
}

export interface SubscriptionFeatureView {
  feature: string;
  prices: { 1: number; 3: number; 12: number };
}

export interface Catalog {
  consultation: ConsultationPlanView[];
  subscriptions: SubscriptionFeatureView[];
}

export interface WalletView {
  balanceToman: number;
  txns: Array<{ id: string; kind: string; amountToman: number; at: string; note: string }>;
}

export interface NotificationView {
  notificationId: string;
  kind: string;
  titleFa: string;
  bodyFa: string;
  at: string;
  read: boolean;
  delivered: { inApp: boolean; sms?: boolean };
}

export interface TossPosition {
  ticket: { ticketId: string; minutes: number; status: string; joinedAt: string };
  position: number;
  waitingAhead: number;
  etaMinutes: number;
  lawyerOnline: boolean;
  queueOpen: boolean;
}

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
