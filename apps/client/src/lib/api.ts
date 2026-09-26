/**
 * Browser → same-origin `/api/*` → the API service. The browser never calls
 * the API host directly; next.config.js rewrites `/api` to it.
 *
 * The portal shares its origin with the office dashboard, so it keeps its
 * session under its own storage keys.
 */

const TOKEN_KEY = 'lp_portal_token';
const REFRESH_KEY = 'lp_portal_refresh';
/** Fired on window when the session has expired and could not be renewed. */
export const SIGNED_OUT_EVENT = 'lp-portal:signed-out';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

/** Store (or clear, with null) the access token and, optionally, the refresh token. */
export function setToken(token: string | null, refreshToken?: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
  if (!token) window.localStorage.removeItem(REFRESH_KEY);
  else if (refreshToken) window.localStorage.setItem(REFRESH_KEY, refreshToken);
}

/** Revoke the server session (best effort) and clear local tokens. */
export async function signOut(): Promise<void> {
  const token = getToken();
  setToken(null);
  if (!token) return;
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  } catch {
    /* offline: the session expires on its own */
  }
}

let refreshing: Promise<boolean> | null = null;

function renewSession(): Promise<boolean> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const refreshToken = window.localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return false;
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const out = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!out.accessToken) return false;
      setToken(out.accessToken, out.refreshToken);
      return true;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export class ApiError extends Error {
  public readonly code?: string;

  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`API ${status}`);
    this.code = (body as { error?: { code?: string } } | undefined)?.error?.code;
  }
}

/** Friendly Persian text for codes whose server message is not meant for clients. */
const ERROR_TEXT: Record<string, string> = {
  AUTH_RATE_LIMITED: 'تعداد درخواست‌ها زیاد بوده است. چند دقیقه بعد دوباره تلاش کنید.',
  AUTH_RESEND_COOLDOWN: 'کد قبلی تازه ارسال شده است. کمی صبر کنید و دوباره درخواست دهید.',
  AUTH_INVALID_CODE: 'کد واردشده درست نیست.',
  AUTH_CODE_EXPIRED: 'کد منقضی شده است. کد تازه‌ای درخواست کنید.',
  AUTH_INVALID_TOKEN: 'نشست شما به پایان رسیده است. دوباره وارد شوید.',
  AUTH_MISSING_TOKEN: 'برای ادامه وارد حساب خود شوید.',
  AUTH_SESSION_EXPIRED: 'نشست شما به پایان رسیده است. دوباره وارد شوید.',
  AUTH_SESSION_REVOKED: 'نشست شما بسته شده است. دوباره وارد شوید.',
  AUTH_DEPENDENCY_DOWN: 'سرور موقتاً در دسترس نیست. کمی بعد دوباره تلاش کنید.',
  VALIDATION_INVALID_PHONE: 'شمارهٔ موبایل معتبر نیست.',
  PROVIDER_UNAVAILABLE: 'ارسال پیامک در این سرور هنوز راه‌اندازی نشده است. با دفتر وکالت تماس بگیرید.',
  WALLET_INSUFFICIENT_FUNDS: 'موجودی کیف پول کافی نیست. ابتدا کیف پول را شارژ کنید.',
  LAWYER_OFFLINE: 'وکیل در حال حاضر آنلاین نیست. وقتی آنلاین شود، می‌توانید وارد صف شوید.',
  QUEUE_CLOSED: 'صف مشاوره در حال حاضر بسته است.',
  PAYMENT_GATEWAY_ERROR: 'درگاه پرداخت پاسخ نداد. کمی بعد دوباره تلاش کنید.',
  SYSTEM_ROUTE_NOT_FOUND: 'این امکان در نسخهٔ فعلی سرور در دسترس نیست.',
};

/** Human-readable text for any error thrown by `api`. */
export function errText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code && ERROR_TEXT[e.code]) return ERROR_TEXT[e.code];
    const body = e.body as { error?: { message?: unknown }; message?: unknown } | undefined;
    const message = body?.error?.message ?? body?.message;
    // Messages that are just a code (e.g. "AUTH_INVALID_TOKEN") are not for people.
    if (typeof message === 'string' && message && !/^[A-Z][A-Z0-9_]+$/.test(message)) return message;
    if (e.status >= 500) return 'خطایی در سرور رخ داد. کمی بعد دوباره تلاش کنید.';
    return `درخواست انجام نشد (${e.code ?? e.status}).`;
  }
  return 'اتصال به سرور برقرار نشد. اتصال اینترنت را بررسی کنید.';
}

async function request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  const text = await res.text();
  let parsed: unknown = undefined;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }
  if (res.status === 401 && token && !path.startsWith('/auth/')) {
    // Access tokens are short-lived: renew once and retry, otherwise sign out.
    if (!retried && (await renewSession())) return request<T>(method, path, body, true);
    setToken(null);
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
  if (!res.ok) throw new ApiError(res.status, parsed);
  return parsed as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
};

// ---------------- response shapes (mirror apps/api) ----------------

export interface ConsultationPlanView {
  minutes: 10 | 20 | 30;
  priceToman: number;
  active: boolean;
}

export interface Catalog {
  consultation: ConsultationPlanView[];
}

export interface WalletView {
  balanceToman: number;
  txns: Array<{ id: string; kind: string; amountToman: number; at: string; note: string }>;
}

export interface PurchaseView {
  id: string;
  kind: 'consultation' | 'subscription';
  minutes?: 10 | 20 | 30;
  priceToman: number;
  purchasedAt: string;
  consumed: boolean;
  refunded?: boolean;
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

export interface TelecomsView {
  online: boolean;
  queueOpen: boolean;
  closeReason?: string;
}

export interface QueuePosition {
  ticket: { ticketId: string; minutes: number; status: string; joinedAt: string };
  position: number;
  waitingAhead: number;
  etaMinutes: number;
  lawyerOnline: boolean;
  queueOpen: boolean;
}

export interface SessionUser {
  id: string;
  phoneNormalized: string | null;
  roles: string[];
}
