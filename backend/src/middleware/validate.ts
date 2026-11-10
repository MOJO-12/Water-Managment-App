import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors';

export const validate =
  (schema: ZodTypeAny): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return next(new AppError(400, 'VALIDATION_ERROR', 'Invalid request', result.error.flatten().fieldErrors));
    }
    req.body = result.data;
    next();
  };
