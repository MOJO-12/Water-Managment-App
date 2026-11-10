import { randomUUID } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { corsOrigins, env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFound } from './middleware/errorHandler';
import { globalLimiter } from './middleware/rateLimit';
import { authRouter } from './modules/auth/auth.routes';
import { paymentsRouter } from './modules/payments/payment.routes';
import { catalogRouter } from './modules/catalog/catalog.routes';
import { adminRouter, devEnabled, devRouter, driverRouter, ordersRouter } from './modules/orders/order.routes';

// Keeps the secret part of the payment callback address out of the logs.
const redactReq = (req: { id: unknown; method: string; url: string }) => ({
  id: req.id,
  method: req.method,
  url: req.url.replace(/(\/hooks\/stk\/)[^/?]+/, '$1[redacted]'),
});

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      serializers: { req: redactReq },
      genReqId: (_req, res) => {
        const id = randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: (origin, cb) => cb(null, !origin || corsOrigins.includes(origin)) }));
  app.use(express.json({ limit: '10kb' }));

  // Health checks (no rate limit, used by load balancers / Docker)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  app.use('/api/v1', globalLimiter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1', catalogRouter); // /products, /addresses
  app.use('/api/v1/orders', ordersRouter);
  app.use('/api/v1/payments', paymentsRouter);
  app.use('/api/v1/admin', adminRouter);
  app.use('/api/v1/driver', driverRouter);
  if (devEnabled) app.use('/api/v1/dev', devRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
