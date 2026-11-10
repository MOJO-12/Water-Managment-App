import { describe, expect, it } from 'vitest';
import { canTransition, priceOrder, startOfDayNairobi } from '../src/modules/orders/order.rules';
import { createOrderSchema, listQuerySchema } from '../src/modules/orders/order.schemas';

describe('order state machine', () => {
  it('allows the normal delivery path', () => {
    expect(canTransition('PENDING_PAYMENT', 'PLACED')).toBe(true);
    expect(canTransition('PLACED', 'CONFIRMED')).toBe(true);
    expect(canTransition('CONFIRMED', 'DISPATCHED')).toBe(true);
    expect(canTransition('DISPATCHED', 'DELIVERED')).toBe(true);
  });
  it('blocks skipping steps and moving out of final states', () => {
    expect(canTransition('PLACED', 'DELIVERED')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'DISPATCHED')).toBe(false);
    expect(canTransition('DISPATCHED', 'CANCELLED')).toBe(false);
    expect(canTransition('CANCELLED', 'PLACED')).toBe(false);
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });
});

describe('priceOrder', () => {
  it('adds the delivery fee below the free-delivery threshold', () => {
    expect(priceOrder([{ unitPriceKes: 200, quantity: 2 }], 100, 1000)).toEqual({ subtotalKes: 400, deliveryFeeKes: 100, totalKes: 500 });
  });
  it('waives the fee at or above the threshold', () => {
    expect(priceOrder([{ unitPriceKes: 250, quantity: 4 }], 100, 1000)).toEqual({ subtotalKes: 1000, deliveryFeeKes: 0, totalKes: 1000 });
  });
});

describe('startOfDayNairobi', () => {
  it('rolls over at 21:00 UTC (midnight in Nairobi)', () => {
    expect(startOfDayNairobi(Date.parse('2026-11-09T20:59:00Z')).toISOString()).toBe('2026-11-08T21:00:00.000Z');
    expect(startOfDayNairobi(Date.parse('2026-11-09T21:01:00Z')).toISOString()).toBe('2026-11-09T21:00:00.000Z');
  });
});

describe('request schemas', () => {
  const uuid = '3f2b8c1e-6a4d-4b7e-9c10-2d5e8f7a1b34';
  it('accepts a valid order and rejects bad quantities / empty carts', () => {
    expect(createOrderSchema.safeParse({ addressId: uuid, items: [{ productId: uuid, quantity: 2 }] }).success).toBe(true);
    expect(createOrderSchema.safeParse({ addressId: uuid, items: [{ productId: uuid, quantity: 0 }] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ addressId: uuid, items: [] }).success).toBe(false);
    expect(createOrderSchema.safeParse({ addressId: 'x', items: [{ productId: uuid, quantity: 1 }] }).success).toBe(false);
  });
  it('parses admin status filters', () => {
    expect(listQuerySchema.parse({ status: 'PLACED,CONFIRMED' }).status).toEqual(['PLACED', 'CONFIRMED']);
    expect(listQuerySchema.safeParse({ status: 'BOGUS' }).success).toBe(false);
    expect(listQuerySchema.parse({}).limit).toBe(20);
  });
});
