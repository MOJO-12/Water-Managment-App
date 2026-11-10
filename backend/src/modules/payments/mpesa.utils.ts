import { z } from 'zod';

/** Daraja timestamp (YYYYMMDDHHmmss) in Nairobi time (UTC+3, no daylight saving). */
export const nairobiTimestamp = (now: Date = new Date()): string =>
  new Date(now.getTime() + 3 * 3600_000).toISOString().replace(/\D/g, '').slice(0, 14);

export const stkPassword = (shortcode: string, passkey: string, timestamp: string): string =>
  Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');

/** "+254712345678" becomes "254712345678", the format Daraja expects. */
export const toDarajaPhone = (e164: string): string => e164.replace(/^\+/, '');

const callbackSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string().optional(),
      CheckoutRequestID: z.string().min(1),
      ResultCode: z.coerce.number(),
      ResultDesc: z.string().default(''),
      CallbackMetadata: z
        .object({ Item: z.array(z.object({ Name: z.string(), Value: z.union([z.string(), z.number()]).optional() })) })
        .optional(),
    }),
  }),
});

export interface StkCallback {
  checkoutRequestId: string;
  merchantRequestId?: string | undefined;
  resultCode: number;
  resultDesc: string;
  receipt?: string | undefined;
  amount?: number | undefined;
}

/** Validates the (unauthenticated) callback body and pulls out the fields we use. Returns null if malformed. */
export function parseStkCallback(raw: unknown): StkCallback | null {
  const parsed = callbackSchema.safeParse(raw);
  if (!parsed.success) return null;
  const cb = parsed.data.Body.stkCallback;
  const items = new Map((cb.CallbackMetadata?.Item ?? []).map((i) => [i.Name, i.Value] as const));
  const receipt = items.get('MpesaReceiptNumber');
  const amount = items.get('Amount');
  const amountNum = amount === undefined ? undefined : Number(amount);
  return {
    checkoutRequestId: cb.CheckoutRequestID,
    merchantRequestId: cb.MerchantRequestID,
    resultCode: cb.ResultCode,
    resultDesc: cb.ResultDesc,
    receipt: typeof receipt === 'string' && receipt ? receipt : undefined,
    amount: amountNum !== undefined && Number.isFinite(amountNum) ? amountNum : undefined,
  };
}

/** Customer-friendly reason for a failed payment. */
export function friendlyResult(code: number | null | undefined): string {
  switch (code) {
    case 1032:
      return 'You cancelled the payment.';
    case 1:
      return 'Your M-Pesa balance is too low.';
    case 2001:
      return 'The M-Pesa PIN was wrong.';
    case 1037:
      return 'The payment prompt timed out. Please try again.';
    default:
      return 'The payment did not go through. Please try again.';
  }
}
