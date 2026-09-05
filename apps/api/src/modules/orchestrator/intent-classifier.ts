import { IntentKind, LegalField } from '@legal-platform/domain';

/**
 * Deterministic intent classifier (ADR-003, SPEC §11a).
 *
 * Layered AI rule from SPEC §9: deterministic automation first, LLM only as a
 * bounded fallback when confidence is low. This scorer is PURE — no I/O — so
 * it is unit-testable in isolation and forever cheap at runtime.
 *
 * The vocabulary is the Phase-0 seed; P3-T1 teaches it weighted stems and
 * colloquial Persian. Keep terms [domain enums]-aligned, never fork LegalField.
 */

export interface IntentClassification {
  kind: IntentKind;
  field: LegalField;
  /** 0..1 — below LOW_CONFIDENCE the orchestrator may consult the LLM. */
  confidence: number;
  matchedTerms: string[];
}

export const LOW_CONFIDENCE = 0.5;

const FIELD_TERMS: ReadonlyArray<{ field: LegalField; terms: readonly string[] }> = [
  { field: LegalField.CIVIL, terms: ['قانون مدنی', 'قرارداد', 'معامله', 'ملک', 'سند', 'اجاره', 'civil', 'contract', 'property', 'lease'] },
  { field: LegalField.CRIMINAL, terms: ['کیفری', 'جرم', 'مجازات', 'دادسرا', 'بازداشت', 'criminal', 'penal', 'arrest'] },
  { field: LegalField.FAMILY, terms: ['طلاق', 'حضانت', 'مهریه', 'ازدواج', 'نفقه', 'family', 'divorce', 'custody', 'alimony'] },
  { field: LegalField.REGISTRATION, terms: ['ثبت', 'سند رسمی', 'شرکت', 'شناسه ملی', 'registration', 'notary', 'company'] },
  { field: LegalField.COMMERCIAL, terms: ['تجارت', 'چک', 'سفته', 'ورشکستگی', 'commercial', 'cheque', 'bankruptcy'] },
  { field: LegalField.LABOR, terms: ['کار', 'کارگر', 'حقوق', 'اضافه کاری', 'labor', 'employment', 'wage'] },
];

const KIND_SIGNALS: ReadonlyArray<{ kind: IntentKind; signals: readonly string[] }> = [
  { kind: IntentKind.DRAFT_REQUEST, signals: ['تنظیم', 'لایحه', 'دادخواست', 'قرارداد بنویس', 'draft', 'petition', 'write'] },
  { kind: IntentKind.REVIEW_DOCUMENT, signals: ['بررسی', 'بازبینی', 'اشکال', 'review', 'check my'] },
  { kind: IntentKind.SEARCH_LAW, signals: ['ماده', 'قانون', 'آیین‌نامه', 'find', 'article', 'search'] },
];

function hits(terms: readonly string[], q: string): string[] {
  return terms.filter((t) => q.includes(t.toLowerCase()));
}

export class IntentClassifier {
  classify(query: string): IntentClassification {
    const q = query.trim().toLowerCase();

    let bestField: LegalField = LegalField.GENERAL;
    let bestHits: string[] = [];
    for (const { field, terms } of FIELD_TERMS) {
      const found = hits(terms, q);
      if (found.length > bestHits.length) {
        bestField = field;
        bestHits = found;
      }
    }

    let kind: IntentKind = IntentKind.QUESTION;
    let kindHits = 0;
    for (const { kind: k, signals } of KIND_SIGNALS) {
      const found = hits(signals, q).length;
      if (found > kindHits) {
        kind = k;
        kindHits = found;
      }
    }
    if (bestHits.length === 0 && kindHits === 0) {
      return { kind: IntentKind.UNKNOWN, field: LegalField.GENERAL, confidence: 0, matchedTerms: [] };
    }

    // 1 field hit → 0.55, 2 → 0.75, 3+ → 0.9; kind signal adds a bounded bonus.
    const confidence = Math.min(0.95, 0.35 + bestHits.length * 0.2 + kindHits * 0.15);
    return { kind, field: bestField, confidence, matchedTerms: bestHits };
  }
}
