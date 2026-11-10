import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import { addressSchema, idSchema } from '../orders/order.schemas';

export const catalogRouter = Router();

// Public: what can I order?
catalogRouter.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany({ where: { active: true }, orderBy: { priceKes: 'asc' } });
  res.json({
    products: products.map((p) => ({ id: p.id, sku: p.sku, name: p.name, priceKes: p.priceKes, inStock: p.stock > 0 })),
  });
});

// Delivery addresses (saved places with map pin)
catalogRouter.get('/addresses', authenticate, async (req, res) => {
  const addresses = await prisma.address.findMany({
    where: { userId: req.auth!.userId, archived: false },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ addresses });
});

catalogRouter.post('/addresses', authenticate, validate(addressSchema), async (req, res) => {
  const count = await prisma.address.count({ where: { userId: req.auth!.userId, archived: false } });
  if (count >= 10) throw new AppError(409, 'ADDRESS_LIMIT', 'You can save up to 10 addresses');
  const address = await prisma.address.create({ data: { ...req.body, details: req.body.details ?? null, userId: req.auth!.userId } });
  res.status(201).json({ address });
});

catalogRouter.delete('/addresses/:id', authenticate, async (req, res) => {
  const id = idSchema.parse(req.params['id']);
  const { count } = await prisma.address.updateMany({ where: { id, userId: req.auth!.userId }, data: { archived: true } });
  if (count !== 1) throw new AppError(404, 'ADDRESS_NOT_FOUND', 'Address not found');
  res.json({ message: 'Address removed' });
});
