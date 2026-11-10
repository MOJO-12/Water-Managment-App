import { Router } from 'express';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { authenticate, requireRole } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { createOrderSchema, idSchema, listQuerySchema, updateStatusSchema } from './order.schemas';
import { orderService } from './order.service';

const idOf = (p: unknown) => idSchema.parse(p);

/** Customer: /api/v1/orders */
export const ordersRouter = Router();
ordersRouter.use(authenticate);
ordersRouter.post('/', validate(createOrderSchema), async (req, res) => {
  res.status(201).json({ order: await orderService.create(req.auth!.userId, req.body) });
});
ordersRouter.get('/', async (req, res) => {
  res.json(await orderService.listMine(req.auth!.userId, listQuerySchema.parse(req.query)));
});
ordersRouter.get('/:id', async (req, res) => {
  res.json({ order: await orderService.getMine(req.auth!.userId, idOf(req.params['id'])) });
});
ordersRouter.post('/:id/cancel', async (req, res) => {
  res.json({ order: await orderService.cancelByCustomer(req.auth!.userId, idOf(req.params['id'])) });
});

/** Admin: /api/v1/admin */
export const adminRouter = Router();
adminRouter.use(authenticate, requireRole('ADMIN'));
adminRouter.get('/orders/summary', async (_req, res) => res.json(await orderService.dashboardSummary()));
adminRouter.get('/orders', async (req, res) => res.json(await orderService.listAll(listQuerySchema.parse(req.query))));
adminRouter.get('/orders/:id', async (req, res) => res.json({ order: await orderService.getAny(idOf(req.params['id'])) }));
adminRouter.patch('/orders/:id/status', validate(updateStatusSchema), async (req, res) => {
  const id = idOf(req.params['id']);
  const order = await orderService.changeStatus(id, req.body.status, {
    actorId: req.auth!.userId,
    ...(req.body.driverId && { driverId: req.body.driverId }),
    ...(req.body.note && { note: req.body.note }),
  });
  await prisma.auditLog.create({
    data: { actorId: req.auth!.userId, action: 'ORDER_STATUS', target: id, metadata: { to: req.body.status }, ip: req.ip ?? null },
  });
  res.json({ order });
});
adminRouter.get('/drivers', async (_req, res) => res.json(await orderService.listDrivers()));

/** Driver: /api/v1/driver */
export const driverRouter = Router();
driverRouter.use(authenticate, requireRole('DRIVER'));
driverRouter.get('/orders', async (req, res) => res.json(await orderService.listForDriver(req.auth!.userId)));
driverRouter.post('/orders/:id/deliver', async (req, res) => {
  res.json({ order: await orderService.deliverByDriver(req.auth!.userId, idOf(req.params['id'])) });
});

/** Development only: pretend the customer paid, so the whole flow can be tested before M-Pesa exists. */
export const devRouter = Router();
if (env.NODE_ENV === 'development') {
  devRouter.post('/orders/:id/simulate-payment', authenticate, async (req, res) => {
    const id = idOf(req.params['id']);
    await orderService.getMine(req.auth!.userId, id); // must be your own order
    res.json({ order: await orderService.markPaid(id, 'Simulated payment (development)') });
  });
}
export const devEnabled = env.NODE_ENV === 'development';
