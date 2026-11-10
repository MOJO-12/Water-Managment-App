import { z } from 'zod';
import { normalizeKenyanPhone } from '../../lib/phone';

export const stkPushSchema = z.object({
  orderId: z.string().uuid(),
  // Optional: pay from a different M-Pesa number than the account's own.
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const p = normalizeKenyanPhone(v);
      if (!p) {
        ctx.addIssue({ code: 'custom', message: 'Enter a valid Kenyan phone number, e.g. 0712345678' });
        return z.NEVER;
      }
      return p;
    })
    .optional(),
});
