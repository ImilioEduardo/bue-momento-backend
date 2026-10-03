import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

// Find the organizer from otp6.mjs (final@test.com)
const org = await p.organizer.findFirst({ where: { email: 'final@test.com' } });
if (!org) { console.error('Organizer not found'); process.exit(1); }

// Find the 'festa' plan
const plan = await p.plan.findUnique({ where: { id: 'festa' } });
if (!plan) { console.error('Plan not found'); process.exit(1); }

// Check if test event already exists
let event = await p.event.findUnique({ where: { publicCode: 'test2026' } });

if (!event) {
  event = await p.event.create({
    data: {
      organizerId: org.id,
      planId: plan.id,
      name: 'Evento Teste 2026',
      publicCode: 'test2026',
      startsAt: new Date(Date.now() - 2 * 3600_000), // started 2h ago
      endsAt: new Date(Date.now() + 4 * 3600_000),   // ends in 4h
      status: 'ACTIVE',
      challengesPerGuest: 2,
      distribution: 'FIXED',
      moderation: false,
    },
  });
  console.log('Created event:', event.id, event.publicCode);
} else {
  // Ensure it's ACTIVE with valid times
  event = await p.event.update({
    where: { publicCode: 'test2026' },
    data: {
      startsAt: new Date(Date.now() - 2 * 3600_000),
      endsAt: new Date(Date.now() + 4 * 3600_000),
      status: 'ACTIVE',
    },
  });
  console.log('Updated event:', event.id, event.publicCode);
}

// Ensure challenges exist
const existing = await p.challenge.count({ where: { eventId: event.id, active: true } });
if (existing < 2) {
  await p.challenge.createMany({
    data: [
      { eventId: event.id, text: 'Tira uma foto com alguém que acabaste de conhecer', mediaType: 'PHOTO', order: 1, active: true },
      { eventId: event.id, text: 'Grava um vídeo a dizer uma mensagem para os noivos', mediaType: 'VIDEO', order: 2, active: true },
    ],
    skipDuplicates: true,
  });
  console.log('Added 2 challenges');
} else {
  console.log('Challenges already exist:', existing);
}

const challenges = await p.challenge.findMany({ where: { eventId: event.id, active: true } });
console.log('Challenges:', challenges.map(c => `${c.mediaType}: ${c.text.slice(0,50)}`));
console.log('\nEvent code:', event.publicCode);
console.log('Event status:', event.status);

await p.$disconnect();
