import type { OrderStatus } from '@prisma/client';

/** Allowed order status moves. PLACED is set by the payment flow, REFUNDED by the refund flow. */
export const TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING_PAYMENT: ['PLACED', 'CANCELLED'],
  PLACED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
};

export const ACTIVE_STATUSES: readonly OrderStatus[] = ['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'DISPATCHED'];

export const canTransition = (from: OrderStatus, to: OrderStatus): boolean => TRANSITIONS[from]?.includes(to) ?? false;

/** Prices an order from server-side prices only (never trust prices sent by the app). */
export function priceOrder(
  lines: { unitPriceKes: number; quantity: number }[],
  deliveryFeeKes: number,
  freeDeliveryOverKes: number,
) {
  const subtotalKes = lines.reduce((sum, l) => sum + l.unitPriceKes * l.quantity, 0);
  const fee = subtotalKes >= freeDeliveryOverKes ? 0 : deliveryFeeKes;
  return { subtotalKes, deliveryFeeKes: fee, totalKes: subtotalKes + fee };
}

/** Start of the current day in Nairobi (UTC+3, no daylight saving), as a UTC Date. */
export function startOfDayNairobi(now = Date.now()): Date {
  const EAT = 3 * 3600_000;
  const DAY = 86_400_000;
  return new Date(Math.floor((now + EAT) / DAY) * DAY - EAT);
}
