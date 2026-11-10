import { z } from 'zod';
import { normalizeKenyanPhone } from '../../lib/phone';

const phone = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeKenyanPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid Kenyan phone number, e.g. 0712345678' });
      return z.NEVER;
    }
    return normalized;
  });

// bcrypt only uses the first 72 bytes, so cap there.
const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password must contain letters and numbers');

export const registerSchema = z.object({
  name: z.string().trim().min(2).max(80),
  phone,
  email: z.string().trim().toLowerCase().email().max(120).optional(),
  password: newPassword,
});

export const verifyOtpSchema = z.object({
  phone,
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export const resendOtpSchema = z.object({ phone });

export const loginSchema = z.object({
  phone,
  password: z.string().min(1).max(72),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(20).max(200) });

export type RegisterInput = z.infer<typeof registerSchema>;
