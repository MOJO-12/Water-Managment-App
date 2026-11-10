import { OtpPurpose } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { generateOtp, hashOtp, safeEqual } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { sms } from '../../services/sms.service';

const HOUR_MS = 60 * 60 * 1000;

export const otpService = {
  /** Creates a fresh code (invalidating older ones), enforces cooldown + hourly cap, and sends the SMS. */
  async issue(user: { id: string; phone: string }, purpose: OtpPurpose): Promise<{ expiresInSeconds: number }> {
    const now = new Date();

    const latest = await prisma.otpCode.findFirst({
      where: { userId: user.id, purpose },
      orderBy: { createdAt: 'desc' },
    });
    if (latest) {
      const waitSeconds = Math.ceil(
        (latest.createdAt.getTime() + env.OTP_RESEND_COOLDOWN_SECONDS * 1000 - now.getTime()) / 1000,
      );
      if (waitSeconds > 0) {
        throw new AppError(429, 'OTP_COOLDOWN', `Please wait ${waitSeconds}s before requesting a new code`, {
          retryAfterSeconds: waitSeconds,
        });
      }
    }

    const sentLastHour = await prisma.otpCode.count({
      where: { userId: user.id, purpose, createdAt: { gt: new Date(now.getTime() - HOUR_MS) } },
    });
    if (sentLastHour >= env.OTP_MAX_SENDS_PER_HOUR) {
      throw new AppError(429, 'OTP_LIMIT', 'Too many verification codes requested. Try again later.');
    }

    const code = generateOtp();
    const expiresAt = new Date(now.getTime() + env.OTP_TTL_MINUTES * 60 * 1000);

    const [, record] = await prisma.$transaction([
      prisma.otpCode.updateMany({ where: { userId: user.id, purpose, consumedAt: null }, data: { consumedAt: now } }),
      prisma.otpCode.create({
        data: { userId: user.id, purpose, codeHash: hashOtp(env.OTP_SECRET, user.id, purpose, code), expiresAt },
      }),
    ]);

    try {
      await sms.send(
        user.phone,
        `${env.APP_NAME}: your verification code is ${code}. It expires in ${env.OTP_TTL_MINUTES} minutes. Never share it.`,
      );
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Failed to send OTP SMS');
      await prisma.otpCode.delete({ where: { id: record.id } }).catch(() => undefined); // don't burn the cooldown
      throw new AppError(502, 'SMS_FAILED', 'Could not send the verification code. Please try again.');
    }

    return { expiresInSeconds: env.OTP_TTL_MINUTES * 60 };
  },

  /** Verifies and consumes a code. Throws a generic error for wrong/expired/unknown codes. */
  async verify(userId: string, purpose: OtpPurpose, code: string): Promise<void> {
    const invalid = () => new AppError(400, 'OTP_INVALID', 'The code is invalid or has expired');

    const otp = await prisma.otpCode.findFirst({
      where: { userId, purpose, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp) throw invalid();

    // Count the attempt first (atomic) so parallel guesses can't exceed the limit.
    const { attempts } = await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true },
    });
    if (attempts > env.OTP_MAX_ATTEMPTS) {
      await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
      throw new AppError(429, 'OTP_ATTEMPTS_EXCEEDED', 'Too many incorrect attempts. Request a new code.');
    }

    if (!safeEqual(otp.codeHash, hashOtp(env.OTP_SECRET, userId, purpose, code))) throw invalid();

    // Single-use: only one concurrent request can flip consumedAt.
    const { count } = await prisma.otpCode.updateMany({
      where: { id: otp.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (count !== 1) throw invalid();
  },
};
