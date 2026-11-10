/**
 * Normalises Kenyan mobile numbers to E.164 (+2547XXXXXXXX / +2541XXXXXXXX).
 * Accepts 0712345678, 712345678, 254712345678, +254 712 345 678, etc.
 * Returns null when the number is not a valid Kenyan mobile number.
 */
export function normalizeKenyanPhone(input: string): string | null {
  const s = input.replace(/[\s\-()]/g, '');
  const m = /^(?:\+?254|0)?([17]\d{8})$/.exec(s);
  return m ? `+254${m[1]}` : null;
}
