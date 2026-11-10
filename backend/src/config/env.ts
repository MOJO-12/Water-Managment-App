import 'dotenv/config';
import { z } from 'zod';

// Empty values in .env (KEY=) count as "not set".
const optional = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' ? undefined : v), s.optional());

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    APP_NAME: z.string().default('WaterApp'),

    DATABASE_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900), // 15 min
    REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    OTP_TTL_MINUTES: z.coerce.number().int().positive().default(5),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(60),
    OTP_MAX_SENDS_PER_HOUR: z.coerce.number().int().positive().default(5),

    SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
    AT_USERNAME: z.string().optional(), // use "sandbox" for Africa's Talking sandbox
    AT_API_KEY: z.string().optional(),
    AT_SENDER_ID: z.string().optional(),

    DELIVERY_FEE_KES: z.coerce.number().int().nonnegative().default(100),
    FREE_DELIVERY_OVER_KES: z.coerce.number().int().positive().default(1000),
    UNPAID_ORDER_TTL_MINUTES: z.coerce.number().int().positive().default(30),

    MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: optional(z.string()),
    MPESA_CONSUMER_SECRET: optional(z.string()),
    MPESA_SHORTCODE: optional(z.string().regex(/^\d{5,8}$/, 'MPESA_SHORTCODE must be 5 to 8 digits')),
    MPESA_PASSKEY: optional(z.string()),
    MPESA_TRANSACTION_TYPE: z.enum(['CustomerPayBillOnline', 'CustomerBuyGoodsOnline']).default('CustomerPayBillOnline'),
    MPESA_CALLBACK_BASE_URL: optional(z.string().url().transform((u) => u.replace(/\/+$/, ''))),
    MPESA_CALLBACK_SECRET: optional(z.string().regex(/^[A-Za-z0-9_-]{24,}$/, 'MPESA_CALLBACK_SECRET must be 24+ letters/digits')),

    CORS_ORIGINS: z.string().default(''), // comma-separated; mobile apps don't need CORS
    TRUST_PROXY: z.coerce.number().int().nonnegative().default(0), // number of proxies in front of the app
  })
  .superRefine((v, ctx) => {
    if (v.SMS_PROVIDER === 'africastalking' && (!v.AT_USERNAME || !v.AT_API_KEY)) {
      ctx.addIssue({ code: 'custom', message: 'AT_USERNAME and AT_API_KEY are required for africastalking' });
    }
    if (v.NODE_ENV === 'production' && v.SMS_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', message: 'SMS_PROVIDER=console is not allowed in production (it logs OTP codes)' });
    }
    const mpesa = [v.MPESA_CONSUMER_KEY, v.MPESA_CONSUMER_SECRET, v.MPESA_SHORTCODE, v.MPESA_PASSKEY, v.MPESA_CALLBACK_BASE_URL, v.MPESA_CALLBACK_SECRET];
    if (mpesa.some(Boolean) && !mpesa.every(Boolean)) {
      ctx.addIssue({ code: 'custom', message: 'Set all MPESA_ values (key, secret, shortcode, passkey, callback URL, callback secret) or none of them' });
    }
    if (v.MPESA_CALLBACK_BASE_URL && !v.MPESA_CALLBACK_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', message: 'MPESA_CALLBACK_BASE_URL must start with https://' });
    }
    if (v.JWT_ACCESS_SECRET === v.OTP_SECRET) {
      ctx.addIssue({ code: 'custom', message: 'JWT_ACCESS_SECRET and OTP_SECRET must be different' });
    }
  });

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:\n', JSON.stringify(parsed.error.flatten(), null, 2));
  process.exit(1);
}

export const env = parsed.data;
export const corsOrigins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
