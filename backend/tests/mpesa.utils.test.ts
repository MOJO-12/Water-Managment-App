import { describe, expect, it } from 'vitest';
import { friendlyResult, nairobiTimestamp, parseStkCallback, stkPassword, toDarajaPhone } from '../src/modules/payments/mpesa.utils';

describe('daraja helpers', () => {
  it('builds the timestamp in Nairobi time', () => {
    expect(nairobiTimestamp(new Date('2026-11-09T21:30:05Z'))).toBe('20261110003005');
    expect(nairobiTimestamp(new Date('2026-01-01T00:00:00Z'))).toBe('20260101030000');
  });
  it('builds the base64 password', () => {
    expect(stkPassword('174379', 'pass', '20261110003005')).toBe(Buffer.from('174379pass20261110003005').toString('base64'));
  });
  it('drops the plus sign from phone numbers', () => {
    expect(toDarajaPhone('+254712345678')).toBe('254712345678');
  });
  it('gives friendly failure messages', () => {
    expect(friendlyResult(1032)).toContain('cancelled');
    expect(friendlyResult(2001)).toContain('PIN');
    expect(friendlyResult(999)).toContain('did not go through');
  });
});

describe('parseStkCallback', () => {
  const success = {
    Body: {
      stkCallback: {
        MerchantRequestID: 'm1',
        CheckoutRequestID: 'ws_CO_1',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 500 },
            { Name: 'MpesaReceiptNumber', Value: 'QKX1ABC23D' },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };
  it('reads a successful callback', () => {
    expect(parseStkCallback(success)).toMatchObject({ checkoutRequestId: 'ws_CO_1', resultCode: 0, receipt: 'QKX1ABC23D', amount: 500 });
  });
  it('reads a failed callback that has no metadata', () => {
    const failed = { Body: { stkCallback: { CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Request cancelled by user' } } };
    expect(parseStkCallback(failed)).toMatchObject({ checkoutRequestId: 'ws_CO_2', resultCode: 1032, receipt: undefined, amount: undefined });
  });
  it('rejects garbage', () => {
    expect(parseStkCallback({})).toBeNull();
    expect(parseStkCallback(null)).toBeNull();
    expect(parseStkCallback({ Body: { stkCallback: { ResultCode: 0 } } })).toBeNull();
  });
});
