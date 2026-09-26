import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { normalizeIranPhone, toLatinDigits } from '@legal-platform/shared';
import { RequestOtpDto, VerifyEmailOtpDto, VerifyOtpDto } from '../../src/modules/auth/dto/auth.dto';

describe('normalizeIranPhone', () => {
  it('should normalize 09xxxxxxxxx format', () => {
    expect(normalizeIranPhone('09123456789')).toBe('+989123456789');
  });

  it('should normalize 9xxxxxxxxx format', () => {
    expect(normalizeIranPhone('9123456789')).toBe('+989123456789');
  });

  it('should normalize +989xxxxxxxxx format', () => {
    expect(normalizeIranPhone('+989123456789')).toBe('+989123456789');
  });

  it('should normalize 00989xxxxxxxxx format', () => {
    expect(normalizeIranPhone('00989123456789')).toBe('+989123456789');
  });

  it('should normalize 989xxxxxxxxx format', () => {
    expect(normalizeIranPhone('989123456789')).toBe('+989123456789');
  });

  it('should handle spaces and dashes', () => {
    expect(normalizeIranPhone('0912 345 6789')).toBe('+989123456789');
    expect(normalizeIranPhone('0912-345-6789')).toBe('+989123456789');
  });

  it('should return null for invalid numbers', () => {
    expect(normalizeIranPhone('')).toBeNull();
    expect(normalizeIranPhone('12345')).toBeNull();
    expect(normalizeIranPhone('0912345678')).toBeNull(); // too short
    expect(normalizeIranPhone('091234567890')).toBeNull(); // too long
    expect(normalizeIranPhone('09123456789')).not.toBeNull(); // valid
    expect(normalizeIranPhone('08123456789')).toBeNull(); // doesn't start with 9
    expect(normalizeIranPhone(null as any)).toBeNull();
    expect(normalizeIranPhone(undefined as any)).toBeNull();
  });
});

describe('Persian and Arabic-Indic digits', () => {
  it('normalizes a number typed on a Persian keyboard', () => {
    expect(normalizeIranPhone('۰۹۱۲۳۴۵۶۷۸۹')).toBe('+989123456789');
    expect(normalizeIranPhone('٠٩١٢٣٤٥٦٧٨٩')).toBe('+989123456789');
    expect(normalizeIranPhone('۰۹۱۲ ۳۴۵ ۶۷۸۹')).toBe('+989123456789');
  });

  it('converts digits without touching other characters', () => {
    expect(toLatinDigits('کد ۱۲۳۴۵۶')).toBe('کد 123456');
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
  });

  it('accepts Persian digits in the OTP request and verify bodies', async () => {
    const req = plainToInstance(RequestOtpDto, { phone: '۰۹۱۲۳۴۵۶۷۸۹' });
    expect(await validate(req)).toHaveLength(0);
    expect(req.phone).toBe('09123456789');

    const ver = plainToInstance(VerifyOtpDto, { phone: '۰۹۱۲۳۴۵۶۷۸۹', code: ' ۱۲۳۴۵۶ ' });
    expect(await validate(ver)).toHaveLength(0);
    expect(ver.code).toBe('123456');

    const email = plainToInstance(VerifyEmailOtpDto, { email: 'a@example.com', code: '۶۵۴۳۲۱' });
    expect(await validate(email)).toHaveLength(0);
    expect(email.code).toBe('654321');
  });
});
