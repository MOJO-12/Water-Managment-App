import { OrderStatus, Prisma } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import { emitToAdmins, emitToUser } from '../../realtime/socket';
import { ACTIVE_STATUSES, canTransition, priceOrder, startOfDayNairobi } from './order.rules';
import type { CreateOrderInput, ListQuery } from './order.schemas';

const orderInclude = {
  items: { include: { product: { select: { name: true, sku: true } } } },
  address: true,
  driver: { select: { id: true, name: true, phone: true } },
  user: { select: { id: true, name: true, phone: true } },
  events: { orderBy: { createdAt: 'asc' } },
  payments: { select: { id: true, method: true, status: true, amountKes: true } },
} satisfies Prisma.OrderInclude;

type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

const notFound = () => new AppError(404, 'ORDER_NOT_FOUND', 'Order not found');
const summary = (o: OrderFull) => ({
  id: o.id,
  number: o.number,
  status: o.status,
  totalKes: o.totalKes,
  customer: { name: o.user.name },
  createdAt: o.createdAt,
});

const paginate = (q: { page: number; limit: number }) => ({ skip: (q.page - 1) * q.limit, take: q.limit });

async function create(userId: string, input: CreateOrderInput) {
  const address = await prisma.address.findFirst({ where: { id: input.addressId, userId, archived: false } });
  if (!address) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Delivery address not found');

  const qtyByProduct = new Map<string, number>();
  for (const i of input.items) qtyByProduct.set(i.productId, (qtyByProduct.get(i.productId) ?? 0) + i.quantity);
  const ids = [...qtyByProduct.keys()];

  return prisma.$transaction(async (tx) => {
    const products = await tx.product.findMany({ where: { id: { in: ids }, active: true } });
    if (products.length !== ids.length) throw new AppError(400, 'PRODUCT_UNAVAILABLE', 'One or more products are unavailable');

    const lines = [];
    for (const p of products) {
      const quantity = qtyByProduct.get(p.id)!;
      
      const reserved = await tx.product.updateMany({ where: { id: p.id, stock: { gte: quantity } }, data: { stock: { decrement: quantity } } });
      if (reserved.count !== 1) throw new AppError(409, 'OUT_OF_STOCK', `${p.name} is out of stock`);
      lines.push({ productId: p.id, quantity, unitPriceKes: p.priceKes });
    }

    const price = priceOrder(lines, env.DELIVERY_FEE_KES, env.FREE_DELIVERY_OVER_KES);
    return tx.order.create({
      data: {
        userId,
        addressId: address.id,
        subtotalKes: price.subtotalKes,
        deliveryFeeKes: price.deliveryFeeKes,
        totalKes: price.totalKes,
        notes: input.notes ?? null,
        items: { create: lines },
        events: { create: { status: 'PENDING_PAYMENT', note: 'Order created, waiting for payment', actorId: userId } },
      },
      include: orderInclude,
    });
  });
}

interface ChangeOpts {
  actorId?: string;
  driverId?: string;
  note?: string;
}


async function changeStatus(orderId: string, to: OrderStatus, opts: ChangeOpts = {}): Promise<OrderFull> {
  const updated = await prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    if (!canTransition(order.status, to)) {
      throw new AppError(409, 'INVALID_TRANSITION', `Cannot move an order from ${order.status} to ${to}`);
    }

    let driverId: string | undefined;
    if (to === 'DISPATCHED') {
      driverId = opts.driverId ?? order.driverId ?? undefined;
      if (!driverId) throw new AppError(400, 'DRIVER_REQUIRED', 'Assign a driver before dispatching');
      const driver = await tx.user.findFirst({ where: { id: driverId, role: 'DRIVER', isActive: true } });
      if (!driver) throw new AppError(400, 'INVALID_DRIVER', 'Selected driver is not available');
    }

   
    const moved = await tx.order.updateMany({
      where: { id: orderId, status: order.status },
      data: { status: to, ...(driverId && { driverId }) },
    });
    if (moved.count !== 1) throw new AppError(409, 'ORDER_CHANGED', 'Order was just updated. Refresh and try again.');

    if (to === 'CANCELLED') {
      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const i of items) await tx.product.update({ where: { id: i.productId }, data: { stock: { increment: i.quantity } } });
    }

    const wasPaid = order.status !== 'PENDING_PAYMENT';
    const note = opts.note ?? (to === 'CANCELLED' && wasPaid ? 'Cancelled after payment: refund required' : undefined);
    await tx.orderEvent.create({ data: { orderId, status: to, note: note ?? null, actorId: opts.actorId ?? null } });
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: orderInclude });
  });

  const s = summary(updated);
  if (to === 'PLACED') emitToAdmins('order:new', s);
  emitToAdmins('order:status', s);
  emitToUser(updated.userId, 'order:status', s);
  if (to === 'DISPATCHED' && updated.driverId) emitToUser(updated.driverId, 'order:assigned', s);
  return updated;
}

async function markPaid(orderId: string, note = 'Payment received'): Promise<OrderFull> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw notFound();
  if (order.status !== 'PENDING_PAYMENT') return order;
  return changeStatus(orderId, 'PLACED', { note });
}

async function getMine(userId: string, orderId: string) {
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: orderInclude });
  if (!order) throw notFound();
  return order;
}

async function listMine(userId: string, q: ListQuery) {
  const where: Prisma.OrderWhereInput = {
    userId,
    ...(q.active && { status: q.active === 'true' ? { in: [...ACTIVE_STATUSES] } : { notIn: [...ACTIVE_STATUSES] } }),
  };
  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
  ]);
  return { orders, page: q.page, limit: q.limit, total };
}

async function cancelByCustomer(userId: string, orderId: string) {
  const order = await getMine(userId, orderId);
  if (order.status !== 'PENDING_PAYMENT') {
    throw new AppError(409, 'CANNOT_CANCEL', 'This order is already paid. Please contact support to cancel it.');
  }
  return changeStatus(orderId, 'CANCELLED', { actorId: userId, note: 'Cancelled by customer' });
}

async function listAll(q: ListQuery) {
  const where: Prisma.OrderWhereInput = q.status ? { status: { in: q.status } } : {};
  const [total, orders] = await prisma.$transaction([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, ...paginate(q) }),
  ]);
  return { orders, page: q.page, limit: q.limit, total };
}

async function getAny(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: orderInclude });
  if (!order) throw notFound();
  return order;
}

async function dashboardSummary() {
  const grouped = await prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
  const counts: Record<string, number> = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const today = await prisma.order.aggregate({
    where: { createdAt: { gte: startOfDayNairobi() }, status: { in: ['PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED'] } },
    _sum: { totalKes: true },
    _count: { _all: true },
  });
  return { counts, today: { orders: today._count._all, revenueKes: today._sum.totalKes ?? 0 } };
}

async function listDrivers() {
  const drivers = await prisma.user.findMany({
    where: { role: 'DRIVER', isActive: true },
    select: { id: true, name: true, phone: true, _count: { select: { deliveries: { where: { status: 'DISPATCHED' } } } } },
    orderBy: { name: 'asc' },
  });
  return { drivers: drivers.map((d) => ({ id: d.id, name: d.name, phone: d.phone, activeDeliveries: d._count.deliveries })) };
}

async function listForDriver(driverId: string) {
  const orders = await prisma.order.findMany({
    where: { driverId, status: 'DISPATCHED' },
    include: orderInclude,
    orderBy: { updatedAt: 'asc' },
  });
  return { orders };
}

async function deliverByDriver(driverId: string, orderId: string) {
  const owned = await prisma.order.findFirst({ where: { id: orderId, driverId }, select: { id: true } });
  if (!owned) throw notFound();
  return changeStatus(orderId, 'DELIVERED', { actorId: driverId, note: 'Delivered' });
}

/** Cancels unpaid orders and returns their stock. Run on a timer. */
async function expireUnpaid(): Promise<number> {
  const cutoff = new Date(Date.now() - env.UNPAID_ORDER_TTL_MINUTES * 60 * 1000);
  const stale = await prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', createdAt: { lt: cutoff } }, select: { id: true } });
  let done = 0;
  for (const { id } of stale) {
    try {
      await changeStatus(id, 'CANCELLED', { note: 'Payment not received in time' });
      done++;
    } catch (err) {
      logger.warn({ err, orderId: id }, 'Could not expire unpaid order');
    }
  }
  return done;
}

export const orderService = {
  create, changeStatus, markPaid, getMine, listMine, cancelByCustomer,
  listAll, getAny, dashboardSummary, listDrivers, listForDriver, deliverByDriver, expireUnpaid,
};
