import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { JoinEventDto } from './dto/join-event.dto.js';

type FrontendAssignmentStatus = 'PENDING' | 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

function computeStatus(
  submissions: Array<{ status: string }>,
): FrontendAssignmentStatus {
  if (!submissions.length) return 'PENDING';
  const s = submissions.map((s) => s.status);
  if (s.includes('READY') || s.includes('HIDDEN')) return 'READY';
  if (s.includes('PROCESSING')) return 'PROCESSING';
  if (s.includes('UPLOADING')) return 'UPLOADING';
  return 'FAILED';
}

function effectiveMaxSeconds(event: {
  extendedMaxSeconds?: number | null;
  plan?: { maxVideoSeconds: number } | null;
}) {
  return event.extendedMaxSeconds ?? event.plan?.maxVideoSeconds ?? 30;
}

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ── Dev TUS upload state (memory-only, dev mode) ─────────────────────────
  private readonly devTusUploads = new Map<string, { offset: number; total: number }>();

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
      } else if (now > new Date(event.endsAt.getTime() + event.graceHours * 3600_000)) {
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
    };
  }

  async joinEvent(code: string, dto: JoinEventDto) {
    const event = await this.prisma.event.findUnique({
      where: { publicCode: code },
      include: { plan: true },
    });
    if (!event) throw new NotFoundException({ code: 'EVENT_NOT_FOUND' });
    if (event.status !== 'ACTIVE') throw new BadRequestException({ code: 'EVENT_NOT_ACTIVE' });

    const guestCount = await this.prisma.guest.count({ where: { eventId: event.id } });
    const maxGuests = (event.plan?.maxGuests ?? 0) + event.extraGuests;
    if (guestCount >= maxGuests) throw new ConflictException({ code: 'EVENT_FULL' });

    // Upsert guest (same device rejoins)
    let guest = await this.prisma.guest.findFirst({
      where: { eventId: event.id, deviceId: dto.deviceId },
    });

    if (guest?.blockedAt != null) throw new ForbiddenException({ code: 'GUEST_BLOCKED' });

    if (!guest) {
      // Check duplicate phone
      const byPhone = await this.prisma.guest.findFirst({
        where: { eventId: event.id, phone: dto.phone },
      });
      if (byPhone) {
        guest = byPhone;
      } else {
        guest = await this.prisma.guest.create({
          data: {
            eventId: event.id,
            name: dto.name,
            phone: dto.phone,
            deviceId: dto.deviceId,
            consentAt: new Date(),
          },
        });
        // Assign challenges
        await this.assignChallenges(guest.id, event.id, event.challengesPerGuest, event.distribution);
      }
    }

    const guestToken = await this.jwt.signAsync(
      { sub: guest.id, eventId: event.id, type: 'guest' },
      {
        secret: this.config.get<string>('JWT_GUEST_SECRET'),
        expiresIn: '90d',
      },
    );

    return { guestToken };
  }

  private async assignChallenges(
    guestId: string,
    eventId: string,
    count: number,
    distribution: string,
  ) {
    const challenges = await this.prisma.challenge.findMany({
      where: { eventId, active: true },
      orderBy: { order: 'asc' },
    });
    if (!challenges.length) return;

    let selected =
      distribution === 'RANDOM'
        ? [...challenges].sort(() => Math.random() - 0.5).slice(0, count)
        : challenges.slice(0, count);

    await this.prisma.assignment.createMany({
      data: selected.map((c) => ({ guestId, challengeId: c.id })),
      skipDuplicates: true,
    });
  }

  async getAssignments(guestId: string, eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { plan: true },
    });
    const maxSec = effectiveMaxSeconds(event ?? {});

    const assignments = await this.prisma.assignment.findMany({
      where: { guestId },
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
    const maxSec = effectiveMaxSeconds(event ?? {});

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

  async initVideoUpload(guestId: string, eventId: string, aid: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { id: aid, guestId },
    });
    if (!a) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND' });

    const submission = await this.prisma.submission.create({
      data: { assignmentId: aid, mediaType: 'VIDEO', status: 'UPLOADING' },
    });

    const cfAccount = this.config.get<string>('CF_ACCOUNT_ID');
    const cfToken = this.config.get<string>('CF_STREAM_API_TOKEN');

    if (cfAccount && cfToken) {
      // Real Cloudflare Stream TUS upload URL
      const res = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${cfAccount}/stream?direct_user=true`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cfToken}`,
            'Tus-Resumable': '1.0.0',
            'Upload-Length': '0',
            'Upload-Metadata': `requiresignedurls`,
          },
        },
      );
      const tusUploadUrl = res.headers.get('location') ?? '';
      const streamUid = res.headers.get('stream-media-id') ?? undefined;
      await this.prisma.submission.update({
        where: { id: submission.id },
        data: { streamUid },
      });
      return { submissionId: submission.id, tusUploadUrl };
    }

    // Dev stub: point to our mock TUS endpoint
    const backendUrl = `http://localhost:${this.config.get('PORT') ?? 3001}`;
    const tusUploadUrl = `${backendUrl}/api/v1/dev/tus/${submission.id}`;
    this.devTusUploads.set(submission.id, { offset: 0, total: 0 });
    return { submissionId: submission.id, tusUploadUrl };
  }

  async initPhotoUpload(guestId: string, eventId: string, aid: string) {
    const a = await this.prisma.assignment.findFirst({
      where: { id: aid, guestId },
    });
    if (!a) throw new NotFoundException({ code: 'ASSIGNMENT_NOT_FOUND' });

    const submission = await this.prisma.submission.create({
      data: { assignmentId: aid, mediaType: 'PHOTO', status: 'UPLOADING' },
    });

    const r2Account = this.config.get<string>('R2_ACCOUNT_ID');
    const r2Key = this.config.get<string>('R2_ACCESS_KEY_ID');
    const r2Secret = this.config.get<string>('R2_SECRET_ACCESS_KEY');
    const r2Bucket = this.config.get<string>('R2_BUCKET');

    if (r2Account && r2Key && r2Secret && r2Bucket) {
      const putUrl = await generateR2PutUrl(r2Account, r2Key, r2Secret, r2Bucket, submission.id);
      return { submissionId: submission.id, putUrl };
    }

    // Dev stub
    const backendUrl = `http://localhost:${this.config.get('PORT') ?? 3001}`;
    const putUrl = `${backendUrl}/api/v1/dev/photo/${submission.id}`;
    return { submissionId: submission.id, putUrl };
  }

  async getSubmission(guestId: string, sid: string) {
    const sub = await this.prisma.submission.findFirst({
      where: {
        id: sid,
        assignment: { guestId },
      },
    });
    if (!sub) throw new NotFoundException({ code: 'SUBMISSION_NOT_FOUND' });

    const status = sub.status;
    return { id: sub.id, status };
  }

  async completePhotoSubmission(guestId: string, sid: string) {
    const sub = await this.prisma.submission.findFirst({
      where: { id: sid, assignment: { guestId } },
    });
    if (!sub) throw new NotFoundException({ code: 'SUBMISSION_NOT_FOUND' });

    // In production this would trigger thumbnail generation via R2 event
    // For MVP, mark READY immediately
    await this.prisma.submission.update({
      where: { id: sid },
      data: { status: 'READY', readyAt: new Date() },
    });

    await this.markAssignmentDone(sub.assignmentId);
  }

  // ── Dev TUS stub helpers ──────────────────────────────────────────────────

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

// ── Minimal R2 SigV4 presigned PUT (no AWS SDK needed) ────────────────────

async function generateR2PutUrl(
  accountId: string,
  accessKey: string,
  secretKey: string,
  bucket: string,
  key: string,
): Promise<string> {
  const { createHmac, createHash } = await import('crypto');
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = 'auto';
  const service = 's3';
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, '');
  const datetime = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const expires = 3600;

  const credentialScope = `${date}/${region}/${service}/aws4_request`;
  const credential = `${accessKey}/${credentialScope}`;

  const qs = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': datetime,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });

  const canonicalRequest = [
    'PUT',
    `/${bucket}/${key}`,
    qs.toString(),
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    datetime,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const sign = (key: Buffer | string, data: string) =>
    createHmac('sha256', key).update(data).digest();

  const signingKey = sign(
    sign(sign(sign(`AWS4${secretKey}`, date), region), service),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  qs.set('X-Amz-Signature', signature);
  return `https://${host}/${bucket}/${key}?${qs.toString()}`;
}
