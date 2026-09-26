export function nowIso(): string {
  return new Date().toISOString();
}

// Agentic Layer (SPEC §11a): IAgent / ISkill / IExpertAgent / collectors /
// knowledge-graph ports live here so api, web and future clients share them.
export * from './interfaces';
export { createExpertAgent } from './agent-kit';
export type { AgentPersona, ExpertAgentSpec } from './agent-kit';

/**
 * Shared scoring util — every agent's `capabilities.ts` matches on the SAME
 * deterministic formula (society's common law), only vocabularies differ.
 * Weighted: a matched COMPOUND phrase ("حضانت فرزند") counts double — common
 * single words ("طلاق") must never out-talk a specific legal collocation.
 * Score = min(0.95, 0.3 + 0.2 * weight); floor 0. Cap deliberately below 1:
 * nothing here is ever fully certain — 1.0 belongs only to reviewed law.
 */
export function vocabularyScore(terms: readonly string[], query: string): number {
  const q = query.toLowerCase();
  let weight = 0;
  for (const term of terms) {
    const t = term.toLowerCase().trim();
    if (t && q.includes(t)) weight += t.includes(' ') ? 2 : 1;
  }
  return weight === 0 ? 0 : Math.min(0.95, 0.3 + 0.2 * weight);
}

/**
 * Converts Persian (۰–۹) and Arabic-Indic (٠–٩) digits to ASCII digits.
 * Iranian phone keyboards type Persian digits by default, so every numeric
 * input from people (phone numbers, one-time codes, amounts) goes through this.
 */
export function toLatinDigits(value: string): string {
  return value.replace(/[\u06F0-\u06F9\u0660-\u0669]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * Normalizes an Iranian mobile number to +989xxxxxxxxx.
 * Accepts 09xxxxxxxxx, 9xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx and 989xxxxxxxxx,
 * with Persian or Arabic-Indic digits and any spaces, dashes or brackets.
 */
export function normalizeIranPhone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  let digits = toLatinDigits(phone).replace(/\D/g, '');

  if (digits.startsWith('0098')) {
    digits = digits.substring(4);
  } else if (digits.startsWith('98')) {
    digits = digits.substring(2);
  } else if (digits.startsWith('09')) {
    digits = digits.substring(1);
  } else if (!digits.startsWith('9')) {
    return null;
  }

  // Exactly 10 digits starting with 9
  if (!/^9\d{9}$/.test(digits)) {
    return null;
  }

  return `+98${digits}`;
}

/** Lowercases + trims an email and validates it conservatively (ASCII-safe,
 * rejects consecutive dots; enough for an auth destination, not a regex IQ
 * test). Returns null for anything not a single well-formed address. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase();
  if (v.length > 254) return null;
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(v)) return null;
  if (v.includes('..')) return null;
  const [local, domain] = v.split('@');
  if (!local || !domain || !domain.includes('.') || domain.startsWith('-')) return null;
  return v;
}
