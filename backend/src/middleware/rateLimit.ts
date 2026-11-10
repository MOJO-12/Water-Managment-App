import rateLimit from 'express-rate-limit';
import { AppError } from '../lib/errors';

// NOTE: the default store is in-memory (per process). When you run more than one instance,
// switch to a shared store (e.g. rate-limit-redis) so limits are enforced globally.
const limiter = (windowMinutes: number, limit: number) =>
  rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new AppError(429, 'RATE_LIMITED', 'Too many requests. Please slow down.')),
  });

export const globalLimiter = limiter(15, 300);
export const authLimiter = limiter(15, 30); // login / register / refresh
export const otpLimiter = limiter(15, 10); // verify / resend
export const paymentLimiter = limiter(15, 10); // M-Pesa prompts per IP
