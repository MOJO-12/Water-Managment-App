import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { paymentService } from '../modules/payments/payment.service';
import { orderService } from '../modules/orders/order.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Housekeeping timers. Returns a function that stops them (used on shutdown). */
export function startJobs(): () => void {
  // Every hour: remove expired OTPs and expired/old-revoked refresh tokens.
  const purge = async () => {
    try {
      const cutoff = new Date(Date.now() - DAY_MS);
      const [otps, tokens] = await Promise.all([
        prisma.otpCode.deleteMany({ where: { expiresAt: { lt: cutoff } } }),
        prisma.refreshToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] } }),
      ]);
      logger.debug({ otps: otps.count, tokens: tokens.count }, 'Cleanup complete');
    } catch (err) {
      logger.error({ err }, 'Cleanup job failed');
    }
  };
  // Every 5 minutes: cancel unpaid orders and return their stock.
  const expire = async () => {
    try {
      const n = await orderService.expireUnpaid();
      if (n > 0) logger.info({ expired: n }, 'Expired unpaid orders');
    } catch (err) {
      logger.error({ err }, 'Order expiry job failed');
    }
  };
  // Every minute: ask M-Pesa about payments whose callback never arrived.
  const reconcile = async () => {
    try {
      const n = await paymentService.reconcileStale();
      if (n > 0) logger.info({ resolved: n }, 'Reconciled pending payments');
    } catch (err) {
      logger.error({ err }, 'Payment reconcile job failed');
    }
  };
  const timers = [setInterval(purge, 60 * 60 * 1000), setInterval(expire, 5 * 60 * 1000), setInterval(reconcile, 60 * 1000)];
  timers.forEach((t) => t.unref());
  return () => timers.forEach(clearInterval);
}
