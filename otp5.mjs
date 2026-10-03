import { PrismaClient } from '@prisma/client'; import bcrypt from 'bcryptjs';
const p = new PrismaClient();
await p.otpCode.deleteMany({ where: { target: 'flow@test.com' } });
const h = await bcrypt.hash('555444', 10);
await p.otpCode.create({ data: { target: 'flow@test.com', codeHash: h, expiresAt: new Date(Date.now()+600000) } });
await p.$disconnect();
