import { Router } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { safeEqual } from '../../lib/crypto';
import { logger } from '../../lib/logger';
import { authenticate } from '../../middleware/auth';
import { paymentLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { idSchema } from '../orders/order.schemas';
import { stkPushSchema } from './payment.schemas';
import { paymentService } from './payment.service';

export const paymentsRouter = Router();

/** Customer: start an M-Pesa prompt for one of their unpaid orders. */
paymentsRouter.post('/mpesa/stk-push', authenticate, paymentLimiter, validate(stkPushSchema), async (req, res) => {
  res.status(201).json(await paymentService.initiateMpesa(req.auth!.userId, req.body.orderId, req.body.phone));
});

/** Customer: poll the result (the app can also just listen for the order:status / payment:failed socket events). */
paymentsRouter.get('/:id', authenticate, async (req, res) => {
  res.json(await paymentService.getForCustomer(req.auth!.userId, idSchema.parse(req.params['id'])));
});

/**
 * Safaricom calls this. Safaricom does not sign callbacks, so the address itself carries a secret;
 * a wrong secret looks like any other missing route. The payment is also matched by CheckoutRequestID and amount.
 */
paymentsRouter.post('/hooks/stk/:secret', async (req, res) => {
  const expected = env.MPESA_CALLBACK_SECRET;
  if (!expected || !safeEqual(String(req.params['secret']), expected)) {
    throw new AppError(404, 'NOT_FOUND', 'Route not found');
  }
  try {
    await paymentService.handleStkCallback(req.body);
  } catch (err) {
    // Still acknowledge. The reconcile job will settle the payment from Daraja's side.
    logger.error({ err }, 'STK callback processing failed');
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});
