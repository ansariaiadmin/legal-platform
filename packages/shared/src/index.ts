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
 * Normalize Iranian phone numbers to +989xxxxxxxxx format
 * Accepts: 09xxxxxxxxx, 9xxxxxxxxx, +989xxxxxxxxx, 00989xxxxxxxxx
 */
export function normalizeIranPhone(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all non-digit characters except leading +
  const cleaned = phone.trim();
  
  // Check for valid Iranian mobile pattern
  // Remove leading 0, 0098, +98, or 98
  let digits = cleaned.replace(/\D/g, '');
  
  // Handle different prefixes
  if (digits.startsWith('0098')) {
    digits = digits.substring(4);
  } else if (digits.startsWith('+98')) {
    digits = digits.substring(3);
  } else if (digits.startsWith('98')) {
    digits = digits.substring(2);
  } else if (digits.startsWith('09')) {
    digits = digits.substring(1);
  } else if (digits.startsWith('9')) {
    // Already starts with 9, keep as is
  } else {
    return null;
  }

  // Must be exactly 10 digits starting with 9
  if (!/^\d{10}$/.test(digits) || !digits.startsWith('9')) {
    return null;
  }

  return `+98${digits}`;
}

