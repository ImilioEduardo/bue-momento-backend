import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StreamClient } from '../media/stream.client.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.interface.js';
import type { IPaymentProvider } from '../payments/payment-provider.interface.js';

export interface StreamWebhookPayload {
  uid: string;
  status: { state: string };
  duration?: number;
  thumbnail?: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly stream: StreamClient,
    private readonly paymentsService: PaymentsService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: IPaymentProvider,
  ) {}

  // Verifies Cloudflare Stream webhook signature.
  // Header format: "time=<unix_ts>,sig1=<hmac_sha256_hex>"
  // Signature = HMAC-SHA256(secret, "<time>.<rawBody>")
  verifyStreamSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    const secret = this.config.get<string>('STREAM_WEBHOOK_SECRET') ?? '';
    if (!secret) return;

    if (!signatureHeader) {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_MISSING' });
    }

    const parts: Record<string, string> = {};
    for (const part of signatureHeader.split(',')) {
      const idx = part.indexOf('=');
      if (idx > 0) parts[part.slice(0, idx)] = part.slice(idx + 1);
    }

    const time = parts['time'];
    const sig1 = parts['sig1'];
    if (!time || !sig1) {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_MALFORMED' });
    }

    const expected = createHmac('sha256', secret)
      .update(`${time}.${rawBody.toString('utf8')}`)
      .digest('hex');

    if (expected !== sig1) {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
  }

  async handleStreamEvent(payload: StreamWebhookPayload): Promise<void> {
    const uid = payload.uid;
    const state = payload.status?.state;
    if (!uid || !state) return;

    const submission = await this.prisma.submission.findUnique({
      where: { streamUid: uid },
      include: {
        assignment: {
          include: {
            guest: { include: { event: { include: { plan: true } } } },
          },
        },
      },
    });

    if (!submission) {
      this.logger.warn(`Stream webhook for unknown uid=${uid}, state=${state}`);
      return;
    }

    if (state === 'readyToStream') {
      if (submission.status === 'READY') return;

      const event = submission.assignment.guest.event;
      const maxSec = event.extendedMaxSeconds ?? event.plan?.maxVideoSeconds ?? 30;

      if (payload.duration != null && payload.duration > maxSec + 1) {
        this.logger.warn(
          `Submission ${submission.id} exceeds max duration (${payload.duration}s > ${maxSec}s), marking FAILED`,
        );
        await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED' } });
        await this.stream.deleteVideo(uid);
        return;
      }

      await this.stream.requestMp4Download(uid);

      const moderationStatus = event.moderation ? 'PENDING_APPROVAL' : 'APPROVED';

      await this.prisma.$transaction([
        this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: 'READY',
            moderationStatus,
            durationSec: payload.duration ?? null,
            thumbnailUrl: payload.thumbnail ?? null,
            readyAt: new Date(),
          },
        }),
        this.prisma.assignment.update({
          where: { id: submission.assignmentId },
          data: { status: 'DONE' },
        }),
      ]);

      this.logger.log(
        `Submission ${submission.id} → READY moderationStatus=${moderationStatus} (duration=${payload.duration}s)`,
      );
    } else if (state === 'error' || state === 'errored') {
      if (submission.status === 'FAILED') return;
      await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED' } });
      this.logger.warn(`Submission ${submission.id} → FAILED (stream state=${state})`);
    }
  }

  async handlePaymentWebhook(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<void> {
    // Only process webhooks for the configured provider
    if (provider !== this.paymentProvider.providerName) {
      this.logger.warn(
        `Payment webhook for provider=${provider} but configured=${this.paymentProvider.providerName} — ignoring`,
      );
      return;
    }

    const event = this.paymentProvider.verifyWebhook(rawBody, headers);

    const payment = await this.prisma.payment.findFirst({
      where: { reference: event.reference, provider },
    });

    if (!payment) {
      this.logger.warn(`Payment webhook for unknown reference=${event.reference}`);
      return;
    }

    if (event.status === 'PAID') {
      await this.paymentsService.applyPayment(payment.id);
      this.logger.log(`Payment ${payment.id} confirmed via webhook (ref=${event.reference})`);
    } else if (event.status === 'EXPIRED' && payment.status === 'PENDING') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      this.logger.log(`Payment ${payment.id} expired via webhook (ref=${event.reference})`);
    }
  }
}
