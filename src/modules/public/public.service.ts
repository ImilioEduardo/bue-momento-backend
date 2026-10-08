import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Distribution, MediaType, SubmissionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EventLimitsService } from '../events/events-limits.service.js';
import { StreamClient } from '../media/stream.client.js';
import { StorageClient } from '../media/storage.client.js';
import { NOTIFIER } from '../notifications/notifier.interface.js';
import type { Notifier } from '../notifications/notifier.interface.js';
import { JoinEventDto } from './dto/join-event.dto.js';
import { normalizeContact } from '../auth/contact.util.js';
import { RELEASED_DEVICE_PREFIX } from './guest.constants.js';
import { isDevEnv } from '../../config/runtime.js';
import { detectImageType } from '../media/file-signature.js';
import { GUEST_SIGN_OPTIONS } from '../../common/security/jwt.constants.js';

const GUEST_TOKEN_MAX_SEC = 90 * 24 * 60 * 60;
const GUEST_TOKEN_MIN_SEC = 60 * 60;
import { UploadSubmissionDto } from './dto/upload-submission.dto.js';

const ALLOWED_PHOTO_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/heic': '.heic',
  'image/webp': '.webp',
};

const ACTIVE_STATUSES: SubmissionStatus[] = [
  SubmissionStatus.UPLOADING,
  SubmissionStatus.PROCESSING,
  SubmissionStatus.READY,
];

type FrontendAssignmentStatus = 'PENDING' | 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

function computeStatus(submissions: Array<{ status: string }>): FrontendAssignmentStatus {
  if (!submissions.length) return 'PENDING';
  const s = submissions.map((s) => s.status);
  if (s.includes('READY')) return 'READY';
  if (s.includes('PROCESSING')) return 'PROCESSING';
  if (s.includes('UPLOADING')) return 'UPLOADING';
  return 'FAILED';
}

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly limitsService: EventLimitsService,
    private readonly stream: StreamClient,
    private readonly storage: StorageClient,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  // ── Dev TUS upload state (memory-only) ───────────────────────────────────
  private readonly devTusUploads = new Map<string, { offset: number; total: number }>();

  // ── Public event info ─────────────────────────────────────────────────────

  async getPublicEvent(code: string) {
    const event = await this.prisma.event.findUnique({
      where: { publicCode: code },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });

    const now = new Date();
    let status: 'NOT_STARTED' | 'ACTIVE' | 'ENDED' | 'FULL';

    if (event.status === 'ACTIVE') {
      if (now < event.startsAt) {
        status = 'NOT_STARTED';
      } else if (now > new Date(event.endsAt.getTime() + event.graceHours * 3_600_000)) {
        status = 'ENDED';
      } else {
        const guestCount = await this.prisma.guest.count({ where: { eventId: event.id } });
        const maxGuests = (event.plan?.maxGuests ?? 0) + event.extraGuests;
        status = guestCount >= maxGuests ? 'FULL' : 'ACTIVE';
      }
    } else if (event.status === 'DRAFT' || event.status === 'PENDING_PAYMENT') {
      status = 'NOT_STARTED';
    } else {
      status = 'ENDED';
    }

    const guestCount = await this.prisma.guest.count({ where: { eventId: event.id } });

    return {
      id: event.id,
      code: event.publicCode,
      name: event.name,
      coverUrl: event.coverUrl,
      status,
      maxGuests: (event.plan?.maxGuests ?? 0) + event.extraGuests,
      guestCount,
      startAt: event.startsAt.toISOString(),
      endAt: event.endsAt.toISOString(),
      consentText: 'Ao participar aceitas que as tuas gravações sejam partilhadas com o organizador do evento.',
    };
  }

  // ── Join ──────────────────────────────────────────────────────────────────

  async joinEvent(code: string, dto: JoinEventDto) {
    if (!dto.consentAccepted) {
      throw new BadRequestException({ code: 'CONSENT_REQUIRED', message: 'É necessário aceitar o consentimento.' });
    }

    const event = await this.prisma.event.findUnique({
      where: { publicCode: code },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.status !== 'ACTIVE') throw new BadRequestException({ code: 'EVENT_NOT_ACTIVE' });

    const phone = normalizeContact(dto.phone);
    if (dto.deviceId.startsWith(RELEASED_DEVICE_PREFIX)) {
      throw new BadRequestException({ code: 'DEVICE_ID_INVALID' });
    }

    // Re-login: same device already registered for this event
    let guest = await this.prisma.guest.findFirst({
      where: { eventId: event.id, deviceId: dto.deviceId },
    });

    if (guest?.blockedAt != null) throw new ForbiddenException({ code: 'GUEST_BLOCKED', message: 'O teu acesso a este evento foi bloqueado.' });

    if (!guest) {
      const byPhone = await this.prisma.guest.findFirst({
        where: { eventId: event.id, phone },
      });
      if (byPhone) {
        if (byPhone.blockedAt != null) throw new ForbiddenException({ code: 'GUEST_BLOCKED', message: 'O teu acesso a este evento foi bloqueado.' });
        // Saber o telefone NÃO chega para entrar como outro convidado (antes: devolvia o token dele).
        // Só se o organizador tiver libertado o acesso é que o número pode ser associado a um novo dispositivo.
        if (!byPhone.deviceId.startsWith(RELEASED_DEVICE_PREFIX)) {
          throw new ConflictException({
            code: 'GUEST_PHONE_IN_USE',
            message: 'Este número já entrou neste evento noutro dispositivo. Pede ao organizador para libertar o teu acesso.',
          });
        }
        guest = await this.prisma.guest.update({
          where: { id: byPhone.id },
          data: { deviceId: dto.deviceId },
        });
      } else {
        // New guest — enforce limits
        const guestCount = await this.prisma.guest.count({ where: { eventId: event.id } });
        this.limitsService.assertGuestCanJoin(event, guestCount);

        guest = await this.prisma.guest.create({
          data: {
            eventId: event.id,
            name: dto.name,
            phone,
            deviceId: dto.deviceId,
            consentAt: new Date(),
          },
        });

        await this.assignChallenges(guest.id, event.id, event.challengesPerGuest, event.distribution);

        // Notify organizer when the last available slot is taken
        const maxGuests = (event.plan?.maxGuests ?? 0) + event.extraGuests;
        if (guestCount + 1 >= maxGuests) {
          this.notifyGuestLimitReached(event.id, maxGuests).catch(() => {});
        }
      }
    }

    // O token do convidado só vale até ao fim da janela de envio do evento (antes: sempre 90 dias)
    const windowEndMs = event.endsAt.getTime() + event.graceHours * 3_600_000;
    const ttlSec = Math.min(
      GUEST_TOKEN_MAX_SEC,
      Math.max(GUEST_TOKEN_MIN_SEC, Math.ceil((windowEndMs - Date.now()) / 1000)),
    );
    const guestToken = await this.jwt.signAsync(
      // did = dispositivo a que este token pertence; se o acesso for libertado, o token antigo deixa de valer
      { sub: guest.id, eventId: event.id, did: guest.deviceId, type: 'guest' },
      {
        ...GUEST_SIGN_OPTIONS,
        secret: this.config.get<string>('JWT_GUEST_SECRET'),
        expiresIn: ttlSec,
      },
    );

    const assignments = await this.getAssignments(guest.id, event.id);

    return {
      guestToken,
      guest: { id: guest.id, name: guest.name, phone: guest.phone },
      assignments,
    };
  }

  // ── Balanced challenge assignment ─────────────────────────────────────────

  private async assignChallenges(
    guestId: string,
    eventId: string,
    count: number,
    distribution: Distribution,
  ) {
    const challenges = await this.prisma.challenge.findMany({
      where: { eventId, active: true },
      orderBy: { order: 'asc' },
    });
    if (!challenges.length) return;

    // Build per-challenge assignment counts for balanced RANDOM distribution
    const assignmentCounts = new Map<string, number>();
    const countRows = await this.prisma.assignment.groupBy({
      by: ['challengeId'],
      where: { challenge: { eventId } },
      _count: { challengeId: true },
    });
    for (const row of countRows) {
      assignmentCounts.set(row.challengeId, row._count.challengeId);
    }

    const selected = this.limitsService.assignChallenges(
      challenges,
      count,
      distribution,
      assignmentCounts,
    );

    await this.prisma.assignment.createMany({
      data: selected.map((c) => ({ guestId, challengeId: c.id })),
      skipDuplicates: true,
    });
  }

  private async notifyGuestLimitReached(eventId: string, maxGuests: number): Promise<void> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: { select: { name: true, email: true, phone: true } } },
    });
    if (!event?.organizer) return;
    const org = event.organizer;
    const msg = `Olá ${org.name}, o teu evento "${event.name}" atingiu o limite de ${maxGuests} convidados. Compra o extra "+50 convidados" para acomodar mais.`;
    if (org.email) await this.notifier.sendEmail(org.email, 'Limite de convidados atingido — Bué Momentos', `<p>${msg}</p>`);
    if (org.phone) await this.notifier.sendSms(org.phone, msg);
  }

  // ── /public/me ────────────────────────────────────────────────────────────

  async getMe(guestId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });

    const limits = this.limitsService.getEffectiveLimits(event);
    const assignments = await this.getAssignments(guestId, eventId);

    return {
      assignments,
      limits: {
        maxVideoSeconds: limits.maxVideoSeconds,
        maxVideosPerGuest: limits.maxVideosPerGuest,
      },
    };
  }

  // ── Assignments ───────────────────────────────────────────────────────────

  async getAssignments(guestId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { plan: true },
    });

    const maxSec =
      event?.extendedMaxSeconds ?? event?.plan?.maxVideoSeconds ?? 30;

    const assignments = await this.prisma.assignment.findMany({
      // Desafios removidos pelo organizador só continuam visíveis para quem já enviou algo
      where: { guestId, OR: [{ challenge: { active: true } }, { submissions: { some: {} } }] },
      include: {
        challenge: true,
        submissions: { orderBy: { createdAt: 'desc' } },
      },
    });

    return assignments.map((a) => ({
      id: a.id,
      eventId,
      challenge: { id: a.challenge.id, text: a.challenge.text, mediaType: a.challenge.mediaType },
      status: computeStatus(a.submissions),
      maxVideoSeconds: maxSec,
      submissionId: a.submissions[0]?.id,
    }));
  }

  async getAssignment(guestId: string, eventId: string, aid: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { plan: true },
    });

    const maxSec =
      event?.extendedMaxSeconds ?? event?.plan?.maxVideoSeconds ?? 30;

    const a = await this.prisma.assignment.findFirst({
      where: { id: aid, guestId },
      include: {
        challenge: true,
        submissions: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!a) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND' });

    return {
      id: a.id,
      eventId,
      challenge: { id: a.challenge.id, text: a.challenge.text, mediaType: a.challenge.mediaType },
      status: computeStatus(a.submissions),
      maxVideoSeconds: maxSec,
      submissionId: a.submissions[0]?.id,
    };
  }

  // ── Unified upload initiation ─────────────────────────────────────────────

  async initiateUpload(guestId: string, eventId: string, aid: string, dto: UploadSubmissionDto) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: aid, guestId },
      include: {
        challenge: { select: { active: true } },
        submissions: {
          where: { status: { in: [...ACTIVE_STATUSES] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!assignment) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND' });
    if (!assignment.challenge.active) {
      throw new ConflictException({ code: 'CHALLENGE_INACTIVE', message: 'Este desafio foi removido pelo organizador.' });
    }

    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });

    if (!this.limitsService.isWithinSubmissionWindow(event)) {
      throw new BadRequestException({
        code: 'SUBMISSION_WINDOW_CLOSED',
        message: 'O período de envio terminou.',
      });
    }

    const limits = this.limitsService.getEffectiveLimits(event);
    const existingActive = assignment.submissions[0];

    // If this assignment has no active submission, enforce the per-guest video limit
    if (!existingActive) {
      const activeCount = await this.prisma.submission.count({
        where: {
          status: { in: [...ACTIVE_STATUSES] },
          assignment: { guestId },
        },
      });
      if (activeCount >= limits.maxVideosPerGuest) {
        throw new ConflictException({
          code: 'VIDEO_LIMIT_REACHED',
          message: 'Atingiste o limite máximo de envios.',
        });
      }
    }

    // Delete previous active submission (re-upload replaces the old one)
    if (existingActive) {
      if (existingActive.streamUid) await this.stream.deleteVideo(existingActive.streamUid);
      if (existingActive.r2Key) await this.storage.deleteObject(existingActive.r2Key);
      await this.prisma.submission.delete({ where: { id: existingActive.id } });
      await this.prisma.assignment.update({ where: { id: aid }, data: { status: 'PENDING' } });
    }

    // Falhar fechado: em produção sem storage configurado não se aceitam envios
    // (antes: URLs de stub em localhost e fotos marcadas READY sem verificação)
    const storageReady = dto.mediaType === MediaType.VIDEO ? this.stream.isConfigured : this.storage.isConfigured;
    if (!storageReady && !isDevEnv()) {
      throw new ServiceUnavailableException({ code: 'STORAGE_NOT_CONFIGURED', message: 'Envios temporariamente indisponíveis.' });
    }

    if (dto.mediaType === MediaType.VIDEO) {
      if (!dto.uploadLength) {
        throw new BadRequestException({ code: 'UPLOAD_LENGTH_REQUIRED', message: 'uploadLength é obrigatório para vídeos.' });
      }
      return this.createVideoSubmission(eventId, aid, dto.uploadLength, limits.maxVideoSeconds);
    } else {
      if (!dto.contentType || !dto.size) {
        throw new BadRequestException({ code: 'PHOTO_FIELDS_REQUIRED', message: 'contentType e size são obrigatórios para fotos.' });
      }
      return this.createPhotoSubmission(eventId, aid, dto.contentType, dto.size);
    }
  }

  private async createVideoSubmission(
    eventId: string,
    aid: string,
    uploadLength: number,
    maxVideoSeconds: number,
  ) {
    const submission = await this.prisma.submission.create({
      data: { assignmentId: aid, mediaType: 'VIDEO', status: 'UPLOADING' },
    });

    if (!this.stream.isConfigured) {
      // Dev stub: point to the mock TUS endpoint served by this API
      const port = this.config.get<string>('PORT') ?? '3001';
      const tusUploadUrl = `http://localhost:${port}/api/v1/dev/tus/${submission.id}`;
      this.devTusUploads.set(submission.id, { offset: 0, total: 0 });
      return { submissionId: submission.id, tusUploadUrl };
    }

    const expiryISO = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    const { tusUploadUrl, streamUid } = await this.stream.createTusUpload({
      submissionId: submission.id,
      uploadLength,
      maxDurationSec: maxVideoSeconds,
      expiryISO,
    });

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { streamUid },
    });

    return { submissionId: submission.id, tusUploadUrl };
  }

  private async createPhotoSubmission(
    eventId: string,
    aid: string,
    contentType: string,
    sizeBytes: number,
  ) {
    const ext = ALLOWED_PHOTO_TYPES[contentType];
    if (!ext) {
      throw new BadRequestException({
        code: 'INVALID_CONTENT_TYPE',
        message: 'Tipo de imagem não suportado. Use JPEG, PNG, HEIC ou WebP.',
      });
    }

    const submission = await this.prisma.submission.create({
      data: { assignmentId: aid, mediaType: 'PHOTO', status: 'UPLOADING' },
    });

    const r2Key = `events/${eventId}/photos/${submission.id}${ext}`;

    await this.prisma.submission.update({
      where: { id: submission.id },
      data: { r2Key, sizeBytes: BigInt(sizeBytes) },
    });

    const putUrl = await this.storage.presignPutUrl(r2Key, contentType, sizeBytes, 15 * 60);
    return { submissionId: submission.id, putUrl };
  }

  // ── Submission state ──────────────────────────────────────────────────────

  async getSubmission(guestId: string, sid: string) {
    const sub = await this.prisma.submission.findFirst({
      where: { id: sid, assignment: { guestId } },
    });
    if (!sub) throw new NotFoundException({ code: 'SUBMISSION_NOT_FOUND' });
    return { id: sub.id, status: sub.status };
  }

  async completePhotoSubmission(guestId: string, sid: string) {
    const sub = await this.prisma.submission.findFirst({
      where: { id: sid, assignment: { guestId } },
      include: { assignment: { include: { guest: { include: { event: { select: { moderation: true } } } } } } },
    });
    if (!sub) throw new NotFoundException({ code: 'SUBMISSION_NOT_FOUND' });
    if (sub.mediaType !== 'PHOTO' || !sub.r2Key) {
      throw new BadRequestException({ code: 'NOT_A_PHOTO' });
    }
    // Só uma vez e só a partir de UPLOADING (antes: podia "completar" de novo uma submissão já processada)
    if (sub.status !== 'UPLOADING') {
      throw new ConflictException({ code: 'SUBMISSION_NOT_UPLOADING' });
    }

    if (this.storage.isConfigured) {
      const head = await this.storage.headObject(sub.r2Key);
      if (!head.exists) throw new BadRequestException({ code: 'PHOTO_NOT_UPLOADED', message: 'Foto ainda não chegou ao servidor.' });

      // O ficheiro tem de ser mesmo uma imagem do tipo pedido (magic bytes) e do tamanho declarado
      const ext = sub.r2Key.slice(sub.r2Key.lastIndexOf('.'));
      const expectedType = Object.entries(ALLOWED_PHOTO_TYPES).find(([, e]) => e === ext)?.[0];
      const detected = detectImageType(await this.storage.readPrefix(sub.r2Key, 16));
      const sizeOk = sub.sizeBytes == null || (head.sizeBytes != null && BigInt(head.sizeBytes) === sub.sizeBytes);
      if (!expectedType || detected !== expectedType || !sizeOk) {
        this.logger.warn(`Submission ${sid}: ficheiro rejeitado (esperado ${expectedType}, detectado ${detected ?? 'desconhecido'}, sizeOk=${sizeOk})`);
        await this.storage.deleteObject(sub.r2Key);
        await this.prisma.submission.update({ where: { id: sid }, data: { status: 'FAILED' } });
        throw new BadRequestException({ code: 'INVALID_FILE_CONTENT', message: 'O ficheiro enviado não é uma imagem válida.' });
      }
    } else if (!isDevEnv()) {
      throw new ServiceUnavailableException({ code: 'STORAGE_NOT_CONFIGURED' });
    }

    await this.prisma.submission.update({
      where: { id: sid },
      data: {
        status: 'READY',
        readyAt: new Date(),
        // Antes as fotos ficavam sempre PENDING_APPROVAL (mesmo sem moderação) e nunca entravam no ZIP
        moderationStatus: sub.assignment.guest.event.moderation ? 'PENDING_APPROVAL' : 'APPROVED',
      },
    });
    await this.markAssignmentDone(sub.assignmentId);
  }

  // ── Dev TUS stub ──────────────────────────────────────────────────────────

  devTusHead(sid: string) {
    const state = this.devTusUploads.get(sid);
    return { offset: state?.offset ?? 0 };
  }

  async devTusPatch(sid: string, uploadOffset: number, chunkSize: number, uploadLength: number) {
    const newOffset = uploadOffset + chunkSize;
    this.devTusUploads.set(sid, { offset: newOffset, total: uploadLength });

    if (newOffset >= uploadLength && uploadLength > 0) {
      await this.prisma.submission.update({
        where: { id: sid },
        data: { status: 'READY', readyAt: new Date() },
      });
      const sub = await this.prisma.submission.findUnique({
        where: { id: sid },
        select: { assignmentId: true },
      });
      if (sub) await this.markAssignmentDone(sub.assignmentId);
      this.devTusUploads.delete(sid);
    }

    return newOffset;
  }

  async devPhotoAccept(sid: string) {
    await this.prisma.submission.update({
      where: { id: sid },
      data: { status: 'PROCESSING' },
    });
  }

  private async markAssignmentDone(assignmentId: string) {
    await this.prisma.assignment.update({
      where: { id: assignmentId },
      data: { status: 'DONE' },
    });
  }
}
