import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Zod-like validation interface — works with zod schemas or any object with safeParse/parse
 * Falls back to regex-based validation if zod not available (per constraints).
 */

export interface ZodLikeSchema {
  safeParse?: (data: unknown) => { success: boolean; data?: unknown; error?: unknown };
  parse?: (data: unknown) => unknown;
}

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodLikeSchema) {}

  transform(value: unknown): unknown {
    if (this.schema.safeParse) {
      const result = this.schema.safeParse(value);
      if (!result.success) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: result.error?.errors || result.error?.issues || result.error,
        });
      }
      return result.data;
    }

    if (this.schema.parse) {
      try {
        return this.schema.parse(value);
      } catch (error: unknown) {
        throw new BadRequestException({
          message: 'Validation failed',
          errors: error.errors || error.issues || error.message,
        });
      }
    }

    return value;
  }
}

/**
 * Regex-based validation schemas (fallback when zod/parsivar not installable)
 * These cover common Persian legal platform inputs.
 */

export const PersianValidation = {
  // Iranian mobile: 09xxxxxxxxx or +989xxxxxxxxx
  phone: /^(\+98|0)?9\d{9}$/,
  // Email
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  // Persian text (allows Persian, Arabic, English, numbers, punctuation)
  persianText: /^[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFFa-zA-Z0-9\s.,;:!?()\-_"'«»]+$/,
  // OTP code: 4-8 digits
  otpCode: /^\d{4,8}$/,
  // UUID v4
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  // Iranian national ID: 10 digits
  nationalId: /^\d{10}$/,
  // Password: min 8 chars, at least 1 upper, 1 lower, 1 digit
  password: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/,
  // No HTML tags (XSS prevention)
  noHtml: /^[^<>]*$/,
  // Safe filename
  safeFilename: /^[a-zA-Z0-9._-]+\.[a-zA-Z0-9]+$/,
};

export function validateInput(value: string, pattern: RegExp, fieldName: string): void {
  if (!pattern.test(value)) {
    throw new BadRequestException(`${fieldName} validation failed`);
  }
}

export function sanitizeInput(input: string): string {
  // Remove potential XSS vectors
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags entirely
    .replace(/[<>]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/script/gi, '') // Extra safety: remove word script
    .trim();
}

// Zod-like schemas using regex fallback
export const AuthSchemas = {
  phone: {
    safeParse: (data: unknown) => {
      const phone = data?.phone || data;
      if (typeof phone !== 'string' || !PersianValidation.phone.test(phone)) {
        return { success: false, error: { message: 'Invalid phone format' } };
      }
      return { success: true, data: { phone: phone.trim() } };
    },
  },
  otp: {
    safeParse: (data: unknown) => {
      const code = data?.code || data;
      if (typeof code !== 'string' || !PersianValidation.otpCode.test(code)) {
        return { success: false, error: { message: 'Invalid OTP format' } };
      }
      return { success: true, data };
    },
  },
  email: {
    safeParse: (data: unknown) => {
      const email = data?.email || data;
      if (typeof email !== 'string' || !PersianValidation.email.test(email)) {
        return { success: false, error: { message: 'Invalid email format' } };
      }
      return { success: true, data: { email: email.trim().toLowerCase() } };
    },
  },
};
