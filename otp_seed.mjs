import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
const p = new PrismaClient();
await p.otpCode.deleteMany({ where: { target: 'ver@test.com' } });
const h = await bcrypt.hash('777888', 10);
await p.otpCode.create({ data: { target: 'ver@test.com', codeHash: h, expiresAt: new Date(Date.now()+600000) } });
await p.$disconnect();
console.log('seeded');
