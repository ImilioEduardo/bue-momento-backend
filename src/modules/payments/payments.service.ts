import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { EXTRAS } from '../plans/extras.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { NOTIFIER } from '../notifications/notifier.interface.js';
import type { Notifier } from '../notifications/notifier.interface.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  // Shared apply logic used by both admin confirmation and payment webhooks.
  // Idempotent: PAID payments are silently re-acknowledged.
  async applyPayment(paymentId: string): Promise<{ eventId: string }> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { event: { include: { plan: true, organizer: true } } },
    });

    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND' });
    if (payment.status === 'PAID') return { eventId: payment.eventId }; // Idempotent

    if (payment.status !== 'PENDING') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_PENDING',
        message: 'Este pagamento não pode ser confirmado.',
      });
    }

    const event = payment.event;
    const plan = event.plan;
    if (!plan) throw new BadRequestException({ code: 'EVENT_HAS_NO_PLAN' });

    // Parse extras from payment payload
    const extraIds = (
      ((payment.payload as Record<string, unknown>)?.extraIds ?? []) as string[]
    );

    let deltaGuests = 0;
    let deltaVideosPerGuest = 0;
    let deltaRetentionDays = 0;
    let extendedMaxSeconds: number | null = null;

    for (const code of extraIds) {
      const extra = EXTRAS.find((e) => e.code === code);
      if (!extra) continue;
      const match = extra.effect.match(/(\w+)\s*([+]?=)\s*(\d+)/);
      if (!match) continue;
      const [, field, op, valStr] = match;
      const val = parseInt(valStr, 10);
      if (field === 'extraGuests' && op === '+=') deltaGuests += val;
      else if (field === 'extraVideosPerGuest' && op === '+=') deltaVideosPerGuest += val;
      else if (field === 'extraRetentionDays' && op === '+=') deltaRetentionDays += val;
      else if (field === 'extendedMaxSeconds' && op === '=') extendedMaxSeconds = val;
    }

    const now = new Date();
    const isNewPlan = payment.kind === 'PLAN';

    let expiresAt: Date;
    if (isNewPlan) {
      const totalDays = plan.retentionDays + event.extraRetentionDays + deltaRetentionDays;
      expiresAt = new Date(now.getTime() + totalDays * 86_400_000);
    } else {
      const base = event.expiresAt ?? now;
      expiresAt = new Date(base.getTime() + deltaRetentionDays * 86_400_000);
    }

    // Transacção com "trinco" no estado: só um processo consegue passar PENDING → PAID.
    // Antes: ler status → actualizar; dois webhooks simultâneos (ou webhook + admin) somavam os extras duas vezes.
    const applied = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.payment.updateMany({
        where: { id: paymentId, status: 'PENDING' },
        data: { status: 'PAID', paidAt: now },
      });
      if (count === 0) return false;

      await tx.event.update({
        where: { id: event.id },
        data: {
          ...(isNewPlan ? { status: EventStatus.ACTIVE } : {}),
          expiresAt,
          ...(deltaGuests > 0 ? { extraGuests: { increment: deltaGuests } } : {}),
          ...(deltaVideosPerGuest > 0 ? { extraVideosPerGuest: { increment: deltaVideosPerGuest } } : {}),
          ...(deltaRetentionDays > 0 ? { extraRetentionDays: { increment: deltaRetentionDays } } : {}),
          ...(extendedMaxSeconds != null ? { extendedMaxSeconds } : {}),
        },
      });
      return true;
    });

    if (!applied) {
      // Outro processo aplicou (ou expirou) entretanto
      const current = await this.prisma.payment.findUnique({ where: { id: paymentId }, select: { status: true } });
      if (current?.status === 'PAID') return { eventId: payment.eventId };
      throw new BadRequestException({ code: 'PAYMENT_NOT_PENDING', message: 'Este pagamento não pode ser confirmado.' });
    }

    // Notify organizer (fire-and-forget — don't block the response)
    if (isNewPlan && event.organizer) {
      const org = event.organizer;
      const msg = `Olá ${org.name}, o pagamento do teu evento "${event.name}" foi confirmado. O evento está agora activo!`;
      Promise.all([
        org.email ? this.notifier.sendEmail(org.email, 'Evento activo — Bué Momentos', `<p>${msg}</p>`) : Promise.resolve(),
        org.phone ? this.notifier.sendSms(org.phone, msg) : Promise.resolve(),
      ]).catch(() => {});
    }

    return { eventId: event.id };
  }
}
