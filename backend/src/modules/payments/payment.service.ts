import { Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { emitToUser } from '../../realtime/socket';
import { orderService } from '../orders/order.service';
import { initiateStkPush, isMpesaConfigured, queryStkPush } from './mpesa.client';
import { friendlyResult, parseStkCallback, toDarajaPhone } from './mpesa.utils';

const IN_PROGRESS_SECONDS = 90; // don't spam the customer's phone with prompts
const RECONCILE_AFTER_SECONDS = 45; // callback hasn't arrived: ask Daraja
const GIVE_UP_AFTER_MINUTES = 15;

interface PaymentRef {
  id: string;
  orderId: string;
  amountKes: number;
  order: { userId: string };
}

async function failPayment(p: PaymentRef, resultCode: number | null, resultDesc: string): Promise<void> {
  const { count } = await prisma.payment.updateMany({
    where: { id: p.id, status: 'PENDING' },
    data: { status: 'FAILED', resultCode, resultDesc },
  });
  if (count === 1) {
    emitToUser(p.order.userId, 'payment:failed', { paymentId: p.id, orderId: p.orderId, message: friendlyResult(resultCode) });
  }
}

/** Marks the payment paid exactly once, then moves the order to PLACED. */
async function succeedPayment(p: PaymentRef, receipt: string | null, resultDesc: string): Promise<void> {
  let claimed: Prisma.BatchPayload;
  try {
    claimed = await prisma.payment.updateMany({
      where: { id: p.id, status: 'PENDING' },
      data: { status: 'SUCCESS', mpesaReceipt: receipt, resultCode: 0, resultDesc },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.warn({ paymentId: p.id, receipt }, 'Duplicate M-Pesa receipt ignored');
      return;
    }
    throw err;
  }
  if (claimed.count !== 1) return; // already handled by another callback or the reconcile job

  const order = await prisma.order.findUnique({ where: { id: p.orderId }, select: { status: true } });
  if (order?.status === 'PENDING_PAYMENT') {
    await orderService.markPaid(p.orderId, receipt ? `Paid with M-Pesa (${receipt})` : 'Paid with M-Pesa');
    return;
  }
  // Money arrived but the order can't use it (cancelled meanwhile, or a duplicate payment). Flag for a refund.
  const note = `Payment${receipt ? ` ${receipt}` : ''} of KES ${p.amountKes} arrived while the order was ${order?.status ?? 'missing'}: refund required`;
  logger.error({ orderId: p.orderId, paymentId: p.id }, note);
  if (order) await prisma.orderEvent.create({ data: { orderId: p.orderId, status: order.status, note } });
}

async function initiateMpesa(userId: string, orderId: string, phoneOverride?: string) {
  const order = await prisma.order.findFirst({
    where: { id: orderId, userId },
    include: { user: { select: { phone: true } } },
  });
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
  if (order.status !== 'PENDING_PAYMENT') throw new AppError(409, 'ORDER_NOT_PAYABLE', 'This order is not waiting for payment');

  const recent = await prisma.payment.findFirst({
    where: { orderId, method: 'MPESA', status: 'PENDING', createdAt: { gt: new Date(Date.now() - IN_PROGRESS_SECONDS * 1000) } },
  });
  if (recent) {
    throw new AppError(409, 'PAYMENT_IN_PROGRESS', 'A payment prompt was just sent. Check your phone, or wait a minute to try again.');
  }

  const phone = phoneOverride ?? order.user.phone;
  // Amount always comes from the order in our database, never from the app.
  const payment = await prisma.payment.create({ data: { orderId, method: 'MPESA', amountKes: order.totalKes, phone } });
  try {
    const res = await initiateStkPush({
      amountKes: order.totalKes,
      phone: toDarajaPhone(phone),
      reference: `WTR${order.number}`,
      description: 'Water order',
    });
    await prisma.payment.update({
      where: { id: payment.id },
      data: { checkoutRequestId: res.checkoutRequestId, merchantRequestId: res.merchantRequestId },
    });
    return {
      payment: { id: payment.id, status: 'PENDING' as const, amountKes: order.totalKes },
      message: res.customerMessage,
      ...(env.NODE_ENV === 'development' && { devCheckoutRequestId: res.checkoutRequestId }),
    };
  } catch (err) {
    await prisma.payment
      .update({ where: { id: payment.id }, data: { status: 'FAILED', resultDesc: err instanceof AppError ? err.message : 'Could not start payment' } })
      .catch(() => undefined);
    throw err;
  }
}

/** Handles Safaricom's callback. Never throws for bad data: it must always be acknowledged. */
async function handleStkCallback(raw: unknown): Promise<void> {
  const cb = parseStkCallback(raw);
  if (!cb) {
    logger.warn('Ignoring malformed STK callback');
    return;
  }
  const payment = await prisma.payment.findUnique({
    where: { checkoutRequestId: cb.checkoutRequestId },
    include: { order: { select: { userId: true } } },
  });
  if (!payment) {
    logger.warn({ checkoutRequestId: cb.checkoutRequestId }, 'STK callback for an unknown payment');
    return;
  }
  if (payment.status !== 'PENDING') return; // repeated callback: already processed

  if (cb.resultCode !== 0) return failPayment(payment, cb.resultCode, cb.resultDesc);

  if (!cb.receipt || cb.amount === undefined || Math.round(cb.amount) !== payment.amountKes) {
    logger.error(
      { paymentId: payment.id, expected: payment.amountKes, got: cb.amount, receipt: cb.receipt },
      'STK callback does not match the payment: needs manual review',
    );
    return failPayment(payment, cb.resultCode, 'Payment details did not match. Please contact support.');
  }
  await succeedPayment(payment, cb.receipt, cb.resultDesc);
}

/** For payments whose callback never arrived: ask Daraja how the prompt ended. Run on a timer. */
async function reconcileStale(): Promise<number> {
  if (!isMpesaConfigured()) return 0;
  const stale = await prisma.payment.findMany({
    where: {
      method: 'MPESA',
      status: 'PENDING',
      checkoutRequestId: { not: null },
      createdAt: { lt: new Date(Date.now() - RECONCILE_AFTER_SECONDS * 1000) },
    },
    include: { order: { select: { userId: true } } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  let resolved = 0;
  for (const p of stale) {
    try {
      const r = await queryStkPush(p.checkoutRequestId!);
      if (r.resultCode === 0) {
        await succeedPayment(p, null, r.resultDesc ?? 'Confirmed by M-Pesa query');
        resolved++;
      } else if (r.resultCode !== undefined) {
        await failPayment(p, r.resultCode, r.resultDesc ?? '');
        resolved++;
      } else if (p.createdAt < new Date(Date.now() - GIVE_UP_AFTER_MINUTES * 60_000)) {
        await failPayment(p, null, 'No response from M-Pesa');
        resolved++;
      }
    } catch (err) {
      logger.warn({ err, paymentId: p.id }, 'Could not reconcile payment');
    }
  }
  return resolved;
}

async function getForCustomer(userId: string, paymentId: string) {
  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, order: { userId } },
    include: { order: { select: { id: true, number: true, status: true } } },
  });
  if (!payment) throw new AppError(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  return {
    payment: {
      id: payment.id,
      method: payment.method,
      status: payment.status,
      amountKes: payment.amountKes,
      message: payment.status === 'FAILED' ? friendlyResult(payment.resultCode) : null,
    },
    order: payment.order,
  };
}

export const paymentService = { initiateMpesa, handleStkCallback, reconcileStale, getForCustomer };
