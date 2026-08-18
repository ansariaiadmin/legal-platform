export function nowIso(): string {
  return new Date().toISOString();
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

