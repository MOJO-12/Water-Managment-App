import { z } from 'zod';

const STATUS = z.enum(['PENDING_PAYMENT', 'PLACED', 'CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED', 'REFUNDED']);

export const idSchema = z.string().uuid();

export const createOrderSchema = z.object({
  addressId: z.string().uuid(),
  items: z
    .array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(50) }))
    .min(1)
    .max(20),
  notes: z.string().trim().max(300).optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'DISPATCHED', 'DELIVERED', 'CANCELLED']),
  driverId: z.string().uuid().optional(),
  note: z.string().trim().max(200).optional(),
});

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  active: z.enum(['true', 'false']).optional(), // customers: current vs past orders
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined))
    .pipe(z.array(STATUS).optional()), // admin: ?status=PLACED,CONFIRMED
});

export const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  latitude: z.number().min(-5).max(5.5), // Kenya bounding box
  longitude: z.number().min(33).max(42.5),
  details: z.string().trim().max(200).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
