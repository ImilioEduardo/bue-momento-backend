import { Injectable, NotFoundException } from '@nestjs/common';
import { EventStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PaymentsService } from '../payments/payments.service.js';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
  ) {}

  async getOrganizers() {
    const organizers = await this.prisma.organizer.findMany({
      include: { _count: { select: { events: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return organizers.map((o) => ({
      id: o.id,
      name: o.name,
      email: o.email ?? undefined,
      phone: o.phone ?? undefined,
      isAdmin: o.isAdmin,
      eventCount: o._count.events,
      createdAt: o.createdAt.toISOString(),
    }));
  }

  async getEvents() {
    const events = await this.prisma.event.findMany({
      include: {
        plan: true,
        organizer: { select: { name: true } },
        _count: { select: { guests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return events.map((e) => ({
      id: e.id,
      code: e.publicCode,
      name: e.name,
      startAt: e.startsAt.toISOString(),
      endAt: e.endsAt.toISOString(),
      status: e.status,
      distribution: e.distribution,
      challengesPerGuest: e.challengesPerGuest,
      moderationEnabled: e.moderation,
      planId: e.planId ?? undefined,
      guestCount: e._count.guests,
      maxGuests: e.plan ? e.plan.maxGuests + e.extraGuests : 0,
      submissionCount: 0,
    }));
  }

  async getPayments() {
    const payments = await this.prisma.payment.findMany({
      include: {
        event: { select: { name: true, organizer: { select: { name: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return payments.map((p) => ({
      id: p.id,
      eventId: p.eventId,
      eventName: p.event.name,
      organizerName: p.event.organizer?.name ?? '',
      amountKz: p.amountKz,
      reference: p.reference ?? '',
      status: p.status as 'PENDING' | 'PAID' | 'EXPIRED',
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async getConsumption() {
    const [activeEvents, failedUploadsToday] = await Promise.all([
      this.prisma.event.count({ where: { status: EventStatus.ACTIVE } }),
      this.prisma.submission.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return { videoMinutesTotal: 0, storageGbTotal: 0, failedUploadsToday, activeEvents };
  }

  async confirmPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND' });

    await this.payments.applyPayment(paymentId);
    return { ok: true };
  }
}
