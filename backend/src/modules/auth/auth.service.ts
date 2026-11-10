import bcrypt from 'bcryptjs';
import { Role, User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { otpService } from './otp.service';
import { ClientMeta, tokenService } from './token.service';
import type { RegisterInput } from './auth.schemas';

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
// Compared against when the phone is unknown so response time doesn't reveal whether an account exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.BCRYPT_ROUNDS);

export const toPublicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  phone: u.phone,
  email: u.email,
  role: u.role,
  phoneVerified: u.phoneVerified,
});

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({ where: { phone: input.phone } });
    if (existing?.phoneVerified) {
      throw new AppError(409, 'PHONE_TAKEN', 'An account with this phone number already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
    // An unverified account can be re-registered (e.g. user abandoned the OTP step). Only the real
    // phone owner can complete verification, so overwriting its details is safe.
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: { name: input.name, email: input.email ?? null, passwordHash },
        })
      : await prisma.user.create({
          data: { name: input.name, phone: input.phone, email: input.email ?? null, passwordHash, role: Role.CUSTOMER },
        });

    const { expiresInSeconds } = await otpService.issue(user, 'REGISTER');
    return { message: 'Verification code sent', phone: user.phone, otpExpiresInSeconds: expiresInSeconds };
  },

  async verifyRegistration(phone: string, code: string, meta: ClientMeta) {
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || user.phoneVerified || !user.isActive) {
      throw new AppError(400, 'OTP_INVALID', 'The code is invalid or has expired');
    }
    await otpService.verify(user.id, 'REGISTER', code);

    const verified = await prisma.user.update({ where: { id: user.id }, data: { phoneVerified: true } });
    return { user: toPublicUser(verified), tokens: await tokenService.issue(verified, meta) };
  },

  async resendRegistrationOtp(phone: string) {
    const user = await prisma.user.findUnique({ where: { phone } });
    // Same response whether or not the account exists / is already verified.
    if (user && !user.phoneVerified && user.isActive) await otpService.issue(user, 'REGISTER');
    return { message: 'If this number has a pending registration, a new code has been sent.' };
  },

  async login(phone: string, password: string, meta: ClientMeta) {
    const invalid = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid phone number or password');

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      await bcrypt.compare(password, DUMMY_HASH);
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed attempts. Try again in a few minutes.');
    }

    if (!(await bcrypt.compare(password, user.passwordHash))) {
      const { failedLogins } = await prisma.user.update({
        where: { id: user.id },
        data: { failedLogins: { increment: 1 } },
        select: { failedLogins: true },
      });
      if (failedLogins >= MAX_FAILED_LOGINS) {
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60 * 1000) },
        });
      }
      throw invalid();
    }

    if (!user.isActive) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled');

    if (user.failedLogins > 0 || user.lockedUntil) {
      await prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    }

    if (!user.phoneVerified) {
      // Correct password but never verified: send a fresh code and let the app route to the OTP screen.
      await otpService.issue(user, 'REGISTER').catch((e) => {
        if (!(e instanceof AppError && e.code.startsWith('OTP_'))) throw e;
      });
      throw new AppError(403, 'PHONE_NOT_VERIFIED', 'Please verify your phone number', { phone: user.phone });
    }

    return { user: toPublicUser(user), tokens: await tokenService.issue(user, meta) };
  },

  async refresh(refreshToken: string, meta: ClientMeta) {
    return { tokens: await tokenService.rotate(refreshToken, meta) };
  },

  async logout(refreshToken: string) {
    await tokenService.revoke(refreshToken);
    return { message: 'Logged out' };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive) throw new AppError(401, 'UNAUTHORIZED', 'Account unavailable');
    return { user: toPublicUser(user) };
  },
};
