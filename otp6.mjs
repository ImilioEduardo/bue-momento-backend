import { PrismaClient } from '@prisma/client'; import bcrypt from 'bcryptjs';
const p = new PrismaClient();
await p.otpCode.deleteMany({ where: { target: 'final@test.com' } });
const h = await bcrypt.hash('303030', 10);
await p.otpCode.create({ data: { target: 'final@test.com', codeHash: h, expiresAt: new Date(Date.now()+600000) } });
await p.$disconnect();
