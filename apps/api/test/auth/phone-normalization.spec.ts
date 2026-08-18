import { normalizeIranPhone } from '@legal-platform/shared';

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
