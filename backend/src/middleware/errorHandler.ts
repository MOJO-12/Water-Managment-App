import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export const notFound: RequestHandler = (_req, _res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found'));

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? '');
  const send = (status: number, code: string, message: string, details?: unknown) =>
    res.status(status).json({ error: { code, message, ...(details !== undefined && { details }), requestId } });

  if (err instanceof AppError) {
    if (err.code === 'OTP_COOLDOWN' && err.details && typeof err.details === 'object') {
      res.setHeader('Retry-After', String((err.details as { retryAfterSeconds: number }).retryAfterSeconds));
    }
    return send(err.status, err.code, err.message, err.details);
  }
  if (err instanceof ZodError) {
    return send(400, 'VALIDATION_ERROR', 'Invalid request', err.flatten().fieldErrors);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    return send(409, 'CONFLICT', 'A record with these details already exists');
  }
  // body-parser errors (malformed JSON, payload too large)
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) {
    return send(err.status, err.status === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', 'Invalid request body');
  }

  logger.error({ err, requestId }, 'Unhandled error');
  return send(500, 'INTERNAL_ERROR', 'Something went wrong. Please try again.');
};
