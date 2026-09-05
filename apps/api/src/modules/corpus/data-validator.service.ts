import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CollectedItem, IValidatorAgent } from '@legal-platform/shared';

/**
 * The validator hook (SPEC §9, P2-T3): the ONLY path that may set
 * verified_at on a legal document, and it does so exclusively when every
 * deterministic rule passes. Checks:
 *   1. body present + minimum length (law stubs are not law)
 *   2. sha256 recomputes from the raw body (provenance honesty)
 *   3. Persian content ratio (a tier-1 Iranian law must read Persian)
 *   4. tier rules: tier 1 requires an official-source provenance word
 *      (روزنامه رسمی / مجلس شورای اسلامی / قوه قضاییه) in the body.
 * Every failed rule becomes a human-readable reason — the dashboard shows
 * them, nothing hides.
 */

const MIN_CHARS = 200;
const MIN_PERSIAN_RATIO = 0.5;
const OFFICIAL_MARKERS = ['روزنامه رسمی', 'مجلس شورای اسلامی', 'قوه قضاییه', 'دفتر مقام معظم رهبری'];

export interface ValidationOutcome {
  verified: boolean;
  reasons: string[];
}

@Injectable()
export class DataValidatorService implements Pick<IValidatorAgent, 'validate'> {
  async validate(item: CollectedItem): Promise<ValidationOutcome> {
    const reasons: string[] = [];

    if (!item.rawText || item.rawText.trim().length < MIN_CHARS) {
      reasons.push(`متن کوتاه‌تر از ${MIN_CHARS} نویسه است (داشت: ${item.rawText?.trim().length ?? 0})`);
    }

    const sha = await sha256Hex(item.rawText ?? '');
    if (item.contentSha256 && sha !== item.contentSha256) {
      reasons.push('sha256 با بدنهٔ گرفته‌شده هم‌خوانی ندارد');
    }

    if (item.rawText) {
      const persianChars = (item.rawText.match(/[؀-ۿ]/g) ?? []).length;
      const letters = persianChars + ((item.rawText.match(/[a-zA-Z]/g) ?? []).length);
      if (letters === 0 || persianChars / letters < MIN_PERSIAN_RATIO) {
        reasons.push(`نسبت فارسی پایین است (${letters === 0 ? 0 : Math.round((persianChars / letters) * 100)}٪)`);
      }
    }

    if (item.trustTier === 1) {
      const hasMarker = OFFICIAL_MARKERS.some((m) => item.rawText.includes(m));
      if (!hasMarker) reasons.push('سند رسمی (رده ۱) باید نشانهٔ انتشار رسمی را در خود داشته باشد');
    }

    return { verified: reasons.length === 0, reasons };
  }
}

async function sha256Hex(text: string): Promise<string> {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
