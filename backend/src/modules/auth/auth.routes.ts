import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { authLimiter, otpLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { authController as c } from './auth.controller';
import { loginSchema, refreshSchema, registerSchema, resendOtpSchema, verifyOtpSchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate(registerSchema), c.register);
authRouter.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), c.verifyOtp);
authRouter.post('/resend-otp', otpLimiter, validate(resendOtpSchema), c.resendOtp);
authRouter.post('/login', authLimiter, validate(loginSchema), c.login);
authRouter.post('/refresh', authLimiter, validate(refreshSchema), c.refresh);
authRouter.post('/logout', validate(refreshSchema), c.logout);
authRouter.get('/me', authenticate, c.me);
