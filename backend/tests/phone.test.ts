import { describe, expect, it } from 'vitest';
import { normalizeKenyanPhone } from '../src/lib/phone';

describe('normalizeKenyanPhone', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['0112345678', '+254112345678'],
    ['(0712) 345-678', '+254712345678'],
  ])('normalises %s', (input, expected) => expect(normalizeKenyanPhone(input)).toBe(expected));

  it.each(['', '12345', '0812345678', '+255712345678', '07123456789', 'abcdefghij'])('rejects %s', (input) =>
    expect(normalizeKenyanPhone(input)).toBeNull(),
  );
});
