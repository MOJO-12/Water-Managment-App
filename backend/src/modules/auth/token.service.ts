import jwt from 'jsonwebtoken';
import { Role, User } from '@prisma/client';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { randomToken, sha256 } from '../../lib/crypto';

const ISSUER = 'water-delivery-api';
const unauthorized = () => new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please log in again.');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // seconds until the access token expires
}
export interface ClientMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export const signAccessToken = (user: Pick<User, 'id' | 'role'>): string =>
  jwt.sign({ role: user.role }, env.JWT_ACCESS_SECRET, {
    algorithm: 'HS256',
    subject: user.id,
    issuer: ISSUER,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
  });

export function verifyAccessToken(token: string): { userId: string; role: Role } {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'], issuer: ISSUER });
  if (typeof payload === 'string' || !payload.sub || !payload['role']) throw new Error('Malformed token');
  return { userId: payload.sub, role: payload['role'] as Role };
}

async function createRefreshToken(userId: string, meta: ClientMeta): Promise<string> {
  const raw = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(raw), // only the hash is stored
      expiresAt: new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  return raw;
}

export const tokenService = {
  async issue(user: Pick<User, 'id' | 'role'>, meta: ClientMeta): Promise<TokenPair> {
    return {
      accessToken: signAccessToken(user),
      refreshToken: await createRefreshToken(user.id, meta),
      expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    };
  },

  /** Rotates a refresh token. Re-use of an already-rotated token revokes every session of that user. */
  async rotate(raw: string, meta: ClientMeta): Promise<TokenPair> {
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(raw) },
      include: { user: true },
    });
    if (!stored) throw unauthorized();

    if (stored.revokedAt) {
      await prisma.refreshToken.updateMany({ where: { userId: stored.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw unauthorized();
    }
    if (stored.expiresAt <= new Date() || !stored.user.isActive) throw unauthorized();

    const { count } = await prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) throw unauthorized(); // lost a race with a parallel refresh

    return this.issue(stored.user, meta);
  },

  async revoke(raw: string): Promise<void> {
    await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(raw), revokedAt: null }, data: { revokedAt: new Date() } });
  },

  async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  },
};
