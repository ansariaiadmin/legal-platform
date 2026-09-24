import { IntentClassifier, LOW_CONFIDENCE } from '../../src/modules/orchestrator/intent-classifier';
import { IntentKind, LegalField } from '@legal-platform/domain';

describe('IntentClassifier (ADR-003: deterministic first)', () => {
  const classifier = new IntentClassifier();

  it('classifies a civil Persian question with field + draft intent', () => {
    const r = classifier.classify('می‌خوام یک قرارداد اجاره ملک تنظیم کنم');
    expect(r.field).toBe(LegalField.CIVIL);
    expect(r.kind).toBe(IntentKind.DRAFT_REQUEST);
    expect(r.confidence).toBeGreaterThan(LOW_CONFIDENCE);
    expect(r.matchedTerms.length).toBeGreaterThan(0);
  });

  it('classifies family law correctly', () => {
    const r = classifier.classify('شرایط حضانت فرزند بعد از طلاق چیست؟');
    expect(r.field).toBe(LegalField.FAMILY);
    expect(r.kind).toBe(IntentKind.QUESTION);
  });

  it('detects criminal queries in English too', () => {
    const r = classifier.classify('criminal defense strategy for arrest');
    expect(r.field).toBe(LegalField.CRIMINAL);
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('recognizes statute lookup intent', () => {
    const r = classifier.classify('ماده ۱۰ قانون مدنی را پیدا کن');
    expect(r.kind).toBe(IntentKind.SEARCH_LAW);
    expect(r.field).toBe(LegalField.CIVIL);
  });

  it('collectively falls back to UNKNOWN with zero confidence', () => {
    const r = classifier.classify('what is the weather today');
    expect(r.kind).toBe(IntentKind.UNKNOWN);
    expect(r.confidence).toBe(0);
  });

  it('never exceeds 0.95 confidence — LLM tiebreak path always exists (§9)', () => {
    const r = classifier.classify('قرارداد ملک سند معامله تنظیم دادخواست review');
    expect(r.confidence).toBeLessThanOrEqual(0.95);
  });
});
