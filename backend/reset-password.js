require('dotenv/config');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();
const [, , local, password] = process.argv;

(async () => {
  const phone = '+254' + local.replace(/^0/, '');
  const user = await prisma.user.update({
    where: { phone },
    data: { passwordHash: bcrypt.hashSync(password, 12), failedLogins: 0, lockedUntil: null },
  });
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  console.log('Password updated for', user.phone, user.role);
})()
  .catch((e) => console.error('Failed:', e.message))
  .finally(() => prisma.$disconnect());
