import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { AppError } from '../lib/errors';
import { verifyAccessToken } from '../modules/auth/token.service';

declare module 'express-serve-static-core' {
  interface Request {
    auth?: { userId: string; role: Role };
  }
}

/** Requires a valid access token. Stateless: disabled accounts lose access when the short-lived token expires. */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  if (!token) return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch {
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
};

export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.auth) return next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (!roles.includes(req.auth.role)) return next(new AppError(403, 'FORBIDDEN', 'You do not have access to this resource'));
    next();
  };
