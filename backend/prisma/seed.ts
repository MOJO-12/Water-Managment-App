import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '@prisma/client';
import { normalizeKenyanPhone } from '../src/lib/phone';

const prisma = new PrismaClient();

async function main() {
  const phone = normalizeKenyanPhone(process.env.SEED_ADMIN_PHONE ?? '');
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (phone && password && password.length >= 12) {
    await prisma.user.upsert({
      where: { phone },
      update: {},
      create: {
        name: process.env.SEED_ADMIN_NAME ?? 'Admin',
        phone,
        passwordHash: await bcrypt.hash(password, 12),
        role: Role.ADMIN,
        phoneVerified: true,
      },
    });
    console.log(`Admin ready: ${phone}`);
  } else {
    console.log('Skipped admin: set SEED_ADMIN_PHONE and SEED_ADMIN_PASSWORD (12+ chars).');
  }

  const driverPhone = normalizeKenyanPhone(process.env.SEED_DRIVER_PHONE ?? '');
  const driverPassword = process.env.SEED_DRIVER_PASSWORD;
  if (driverPhone && driverPassword && driverPassword.length >= 12) {
    await prisma.user.upsert({
      where: { phone: driverPhone },
      update: {},
      create: { name: 'Test Driver', phone: driverPhone, passwordHash: await bcrypt.hash(driverPassword, 12), role: Role.DRIVER, phoneVerified: true },
    });
    console.log(`Driver ready: ${driverPhone}`);
  }

  const products = [
    { sku: 'WATER-20L', name: '20L Refill', priceKes: 200, stock: 500 },
    { sku: 'WATER-10L', name: '10L Bottle', priceKes: 120, stock: 500 },
    { sku: 'WATER-5L', name: '5L Bottle', priceKes: 70, stock: 500 },
    { sku: 'WATER-500ML-24', name: '500ml x 24 Pack', priceKes: 480, stock: 200 },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }
  console.log('Products seeded');
}

main().finally(() => prisma.$disconnect());
