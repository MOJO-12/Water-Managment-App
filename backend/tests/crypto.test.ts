import { describe, expect, it } from 'vitest';
import { generateOtp, hashOtp, randomToken, safeEqual, sha256 } from '../src/lib/crypto';

describe('crypto helpers', () => {
  it('generates 6-digit numeric codes', () => {
    for (let i = 0; i < 500; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
  });

  it('hashes OTPs deterministically but bound to user, purpose and secret', () => {
    const base = hashOtp('s'.repeat(32), 'u1', 'REGISTER', '123456');
    expect(hashOtp('s'.repeat(32), 'u1', 'REGISTER', '123456')).toBe(base);
    expect(hashOtp('s'.repeat(32), 'u2', 'REGISTER', '123456')).not.toBe(base);
    expect(hashOtp('x'.repeat(32), 'u1', 'REGISTER', '123456')).not.toBe(base);
    expect(hashOtp('s'.repeat(32), 'u1', 'REGISTER', '654321')).not.toBe(base);
  });

  it('compares safely', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });

  it('produces unique tokens and stable hashes', () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256('a')).toBe(sha256('a'));
  });
});
