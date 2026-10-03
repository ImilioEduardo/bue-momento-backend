import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { EXTRAS } from '../plans/extras.js';
import * as QRCode from 'qrcode';
import PDFDocument from 'pdfkit';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';

function mapEvent(event: Record<string, unknown> & {
  startsAt: Date;
  endsAt: Date;
  publicCode: string;
  moderation: boolean;
  extraGuests: number;
  plan?: { maxGuests: number; maxVideosPerGuest: number; retentionDays: number } | null;
  _count?: { guests?: number };
}) {
  return {
    id: event['id'],
    code: event.publicCode,
    name: event['name'],
    startAt: event.startsAt.toISOString(),
    endAt: event.endsAt.toISOString(),
    timezone: event['timezone'],
    coverUrl: event['coverUrl'] ?? undefined,
    status: event['status'],
    distribution: event['distribution'],
    challengesPerGuest: event['challengesPerGuest'],
    moderationEnabled: event.moderation,
    planId: event['planId'] ?? undefined,
    extraGuests: event.extraGuests,
    extraVideosPerGuest: event['extraVideosPerGuest'],
    guestCount: event._count?.guests ?? 0,
    submissionCount: 0,
    maxGuests: event.plan
      ? event.plan.maxGuests + event.extraGuests
      : 0,
    createdAt: event['createdAt'],
  };
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async create(organizerId: string, dto: CreateEventDto) {
    const publicCode = randomBytes(4).toString('hex');
    const event = await this.prisma.event.create({
      data: {
        organizerId,
        name: dto.name,
        startsAt: new Date(dto.startAt),
        endsAt: new Date(dto.endAt),
        timezone: dto.timezone ?? 'Africa/Luanda',
        distribution: dto.distribution,
        challengesPerGuest: dto.challengesPerGuest ?? 3,
        moderation: dto.moderationEnabled ?? false,
        publicCode,
      },
      include: { plan: true, _count: { select: { guests: true } } },
    });
    return mapEvent(event);
  }

  async findAll(organizerId: string) {
    const events = await this.prisma.event.findMany({
      where: { organizerId },
      include: {
        _count: { select: { guests: true } },
        plan: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    return events.map(mapEvent);
  }

  async findOne(organizerId: string, id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: {
        plan: true,
        challenges: { orderBy: { order: 'asc' } },
        _count: { select: { guests: true } },
      },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    return { ...mapEvent(event), challenges: event.challenges };
  }

  async update(organizerId: string, id: string, dto: UpdateEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { plan: true, _count: { select: { guests: true } } },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });

    if (dto.planId && event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({
        code: 'EVENT_PLAN_LOCKED',
        message: 'O plano só pode ser alterado quando o evento está em rascunho.',
      });
    }

    const updated = await this.prisma.event.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.startAt && { startsAt: new Date(dto.startAt) }),
        ...(dto.endAt && { endsAt: new Date(dto.endAt) }),
        ...(dto.timezone && { timezone: dto.timezone }),
        ...(dto.distribution && { distribution: dto.distribution }),
        ...(dto.challengesPerGuest !== undefined && { challengesPerGuest: dto.challengesPerGuest }),
        ...(dto.moderationEnabled !== undefined && { moderation: dto.moderationEnabled }),
        ...(dto.planId && { planId: dto.planId }),
      },
      include: { plan: true, _count: { select: { guests: true } } },
    });
    return mapEvent(updated);
  }

  async remove(organizerId: string, id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({
        code: 'EVENT_NOT_DRAFT',
        message: 'Apenas eventos em rascunho podem ser eliminados.',
      });
    }
    await this.prisma.event.delete({ where: { id } });
    return { message: 'Evento eliminado.' };
  }

  async checkout(organizerId: string, id: string, dto: { planId: string; extraIds: string[] }) {
    const event = await this.prisma.event.findUnique({ where: { id }, include: { plan: true } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    if (event.status !== EventStatus.DRAFT) {
      throw new BadRequestException({ code: 'EVENT_PLAN_LOCKED', message: 'Plano só pode ser selecionado em rascunho.' });
    }

    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException({ code: 'PLAN_NOT_FOUND', message: 'Plano não encontrado.' });

    const extrasTotal = (dto.extraIds ?? []).reduce((sum, code) => {
      const extra = EXTRAS.find((e) => e.code === code);
      return sum + (extra?.priceKz ?? 0);
    }, 0);
    const amountKz = plan.priceKz + extrasTotal;

    const reference = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    await this.prisma.$transaction([
      this.prisma.event.update({ where: { id }, data: { planId: dto.planId, status: EventStatus.PENDING_PAYMENT } }),
      this.prisma.payment.create({
        data: {
          eventId: id,
          kind: 'PLAN',
          description: `Plano ${plan.name}`,
          amountKz,
          provider: 'manual',
          reference,
          entity: '00060',
          status: 'PENDING',
          payload: { extraIds: dto.extraIds },
        },
      }),
    ]);

    return {
      entity: '00060',
      reference,
      amountKz,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async generateQrPng(organizerId: string, id: string): Promise<Buffer> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    if (event.status !== EventStatus.ACTIVE) {
      throw new BadRequestException({ code: 'EVENT_NOT_ACTIVE', message: 'O QR code só está disponível para eventos activos.' });
    }
    const url = `${this.config.get<string>('PUBLIC_WEB_URL')}/e/${event.publicCode}`;
    return QRCode.toBuffer(url, { width: 400, margin: 2 });
  }

  async generateQrCardPdf(organizerId: string, id: string): Promise<Buffer> {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    if (event.status !== EventStatus.ACTIVE) {
      throw new BadRequestException({ code: 'EVENT_NOT_ACTIVE', message: 'O cartão PDF só está disponível para eventos activos.' });
    }

    const url = `${this.config.get<string>('PUBLIC_WEB_URL')}/e/${event.publicCode}`;
    const qrBuffer = await QRCode.toBuffer(url, { width: 250, margin: 2 });

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: [297.6, 419.5], margin: 20 });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(16).font('Helvetica-Bold').text(event.name, { align: 'center' });
      doc.moveDown(0.5);

      const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: event.timezone };
      const dateStr = `${new Intl.DateTimeFormat('pt-AO', dateOpts).format(event.startsAt)} — ${new Intl.DateTimeFormat('pt-AO', dateOpts).format(event.endsAt)}`;
      doc.fontSize(10).font('Helvetica').text(dateStr, { align: 'center' });
      doc.moveDown(1);

      const qrX = (297.6 - 200) / 2;
      doc.image(qrBuffer, qrX, doc.y, { width: 200 });
      doc.moveDown(14);
      doc.fontSize(11).text('Aponta a câmara para o QR code para participar', { align: 'center' });
      doc.end();
    });
  }

  async getPayment(organizerId: string, id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });

    const payment = await this.prisma.payment.findFirst({
      where: { eventId: id, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Pagamento não encontrado.' });

    const expiresAt = new Date(payment.createdAt.getTime() + 72 * 60 * 60 * 1000);
    return {
      entity: payment.entity,
      reference: payment.reference,
      amountKz: payment.amountKz,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getGallery(organizerId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const appUrl = this.config.get<string>('APP_URL') ?? '';
    const r2PublicUrl = this.config.get<string>('R2_PUBLIC_URL') ?? '';

    const submissions = await this.prisma.submission.findMany({
      where: {
        status: { in: ['READY', 'PROCESSING'] },
        assignment: { guest: { eventId } },
      },
      include: {
        assignment: {
          include: {
            guest: true,
            challenge: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return submissions.map((s) => ({
      id: s.id,
      assignmentId: s.assignmentId,
      challengeText: s.assignment.challenge.text,
      guestId: s.assignment.guest.id,
      guestName: s.assignment.guest.name,
      mediaType: s.mediaType,
      status: s.status,
      moderationStatus: s.moderationStatus,
      mediaUrl: s.r2Key
        ? `${r2PublicUrl}/${s.r2Key}`
        : s.streamUid
          ? `${appUrl}/watch/${s.streamUid}`
          : undefined,
      thumbnailUrl: s.thumbnailUrl ?? undefined,
      createdAt: s.createdAt.toISOString(),
    }));
  }

  async moderateSubmission(
    organizerId: string,
    submissionId: string,
    moderationStatus: 'PENDING_APPROVAL' | 'APPROVED' | 'HIDDEN',
  ) {
    const submission = await this.prisma.submission.findUnique({
      where: { id: submissionId },
      include: { assignment: { include: { guest: { include: { event: true } } } } },
    });
    if (!submission) throw new NotFoundException({ code: 'SUBMISSION_NOT_FOUND' });
    if (submission.assignment.guest.event.organizerId !== organizerId)
      throw new ForbiddenException({ code: 'FORBIDDEN' });

    return this.prisma.submission.update({
      where: { id: submissionId },
      data: { moderationStatus },
      select: { id: true, moderationStatus: true },
    });
  }

  async getGuests(organizerId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const guests = await this.prisma.guest.findMany({
      where: { eventId },
      include: { _count: { select: { assignments: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return guests.map((g) => ({
      id: g.id,
      eventId: g.eventId,
      name: g.name,
      phone: g.phone,
      joinedAt: g.createdAt.toISOString(),
      submissionCount: g._count.assignments,
      blockedAt: g.blockedAt?.toISOString() ?? undefined,
    }));
  }

  async updateGuest(
    organizerId: string,
    guestId: string,
    blocked: boolean,
  ) {
    const guest = await this.prisma.guest.findUnique({
      where: { id: guestId },
      include: { event: true },
    });
    if (!guest) throw new NotFoundException({ code: 'GUEST_NOT_FOUND' });
    if (guest.event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    return this.prisma.guest.update({
      where: { id: guestId },
      data: { blockedAt: blocked ? new Date() : null },
      select: { id: true, blockedAt: true },
    });
  }

  async deleteGuest(organizerId: string, guestId: string) {
    const guest = await this.prisma.guest.findUnique({
      where: { id: guestId },
      include: { event: true },
    });
    if (!guest) throw new NotFoundException({ code: 'GUEST_NOT_FOUND' });
    if (guest.event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    await this.prisma.guest.delete({ where: { id: guestId } });
  }

  async createExport(organizerId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const exp = await this.prisma.export.create({
      data: { eventId, status: 'PENDING' },
    });

    // In dev/MVP: mark READY immediately with a placeholder URL
    const updated = await this.prisma.export.update({
      where: { id: exp.id },
      data: { status: 'READY' },
    });

    return { id: updated.id, status: updated.status, downloadUrl: undefined };
  }

  async getExport(organizerId: string, eventId: string, exportId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN' });

    const exp = await this.prisma.export.findUnique({ where: { id: exportId } });
    if (!exp || exp.eventId !== eventId) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND' });

    const r2PublicUrl = this.config.get<string>('R2_PUBLIC_URL') ?? '';
    return {
      id: exp.id,
      status: exp.status,
      downloadUrl: exp.r2Key ? `${r2PublicUrl}/${exp.r2Key}` : undefined,
    };
  }

  async getStats(organizerId: string, id: string) {
    const event = await this.prisma.event.findUnique({
      where: { id },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Evento não encontrado.' });
    if (event.organizerId !== organizerId) throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });

    const [guestCount, submissionCount, guestsWhoSubmitted, challenges] = await Promise.all([
      this.prisma.guest.count({ where: { eventId: id } }),
      this.prisma.submission.count({ where: { assignment: { guest: { eventId: id } } } }),
      this.prisma.guest.count({
        where: { eventId: id, assignments: { some: { submissions: { some: {} } } } },
      }),
      this.prisma.challenge.findMany({
        where: { eventId: id, active: true },
        include: { _count: { select: { assignments: true } } },
      }),
    ]);

    const maxGuests = event.plan ? event.plan.maxGuests + event.extraGuests : 0;

    return {
      guestCount,
      maxGuests,
      submissionCount,
      guestsWhoSubmitted,
      submissionsByChallenge: challenges.map((c) => ({
        challengeId: c.id,
        challengeText: c.text,
        count: c._count.assignments,
      })),
      videoMinutesUsed: 0,
      videoMinutesLimit: 0,
    };
  }
}
