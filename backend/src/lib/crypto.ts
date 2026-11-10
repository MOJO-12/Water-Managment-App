import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Cryptographically secure 6-digit code (leading zeros preserved). */
export const generateOtp = (): string => randomInt(0, 1_000_000).toString().padStart(6, '0');

/**
 * Keyed hash of an OTP. Binding to userId + purpose and keying with a server secret means a leaked
 * database cannot be used to recover the (only 1,000,000-value) code space offline.
 */
export const hashOtp = (secret: string, userId: string, purpose: string, code: string): string =>
  createHmac('sha256', secret).update(`${userId}:${purpose}:${code}`).digest('hex');

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

export const randomToken = (bytes = 48): string => randomBytes(bytes).toString('base64url');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
