import { BadRequestException, Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { safeEqual } from '../../common/security/safe-compare.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { StreamClient } from '../media/stream.client.js';
import { PaymentsService } from '../payments/payments.service.js';
import { PAYMENT_PROVIDER } from '../payments/payment-provider.interface.js';
import type { IPaymentProvider } from '../payments/payment-provider.interface.js';

/**
 * Bunny Stream webhook payload.
 * Status values: 0=Created 1=Uploaded 2=Processing 3=Transcoding 4=Finished 5=Error 6=UploadFailed
 * https://docs.bunny.net/docs/stream-webhook
 */
export interface StreamWebhookPayload {
  VideoLibraryId: number;
  VideoGuid: string;
  Status: number;
  Duration?: number;
  ThumbnailFileName?: string;
}

const BUNNY_STATUS_FINISHED = 4;
const BUNNY_STATUS_ERROR = 5;
const BUNNY_STATUS_UPLOAD_FAILED = 6;

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

  /**
   * Verifies a Bunny Stream webhook signature.
   * Bunny sends: Bunny-Signature: HMAC-SHA256(webhookSecret, rawBody) as hex.
   * Configure BUNNY_WEBHOOK_SECRET to match the secret set in the Bunny library settings.
   * Fails closed: rejects all webhooks if the secret is not configured.
   */
  verifyStreamSignature(rawBody: Buffer, signatureHeader: string | undefined): void {
    const secret = this.config.get<string>('BUNNY_WEBHOOK_SECRET') ?? '';
    if (!secret) {
      throw new UnauthorizedException({ code: 'WEBHOOK_NOT_CONFIGURED' });
    }
    if (!signatureHeader) {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_MISSING' });
    }

    try {
      this.stream.verifyWebhookSignature(rawBody, signatureHeader, secret);
    } catch {
      throw new UnauthorizedException({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    }
  }

  async handleStreamEvent(payload: StreamWebhookPayload): Promise<void> {
    const uid = payload.VideoGuid;
    const status = payload.Status;
    if (!uid || status == null) return;

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
      this.logger.warn(`Bunny webhook for unknown VideoGuid=${uid}, status=${status}`);
      return;
    }

    if (status === BUNNY_STATUS_FINISHED) {
      if (submission.status === 'READY') return;

      const event = submission.assignment.guest.event;
      const maxSec = event.extendedMaxSeconds ?? event.plan?.maxVideoSeconds ?? 30;
      const durationSec = payload.Duration ?? null;

      if (durationSec != null && durationSec > maxSec + 1) {
        this.logger.warn(
          `Submission ${submission.id} exceeds max duration (${durationSec}s > ${maxSec}s), marking FAILED`,
        );
        await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED' } });
        await this.stream.deleteVideo(uid);
        return;
      }

      // requestMp4Download is a no-op for Bunny (auto-transcodes), kept for interface symmetry
      await this.stream.requestMp4Download(uid);

      const moderationStatus = event.moderation ? 'PENDING_APPROVAL' : 'APPROVED';

      await this.prisma.$transaction([
        this.prisma.submission.update({
          where: { id: submission.id },
          data: {
            status: 'READY',
            moderationStatus,
            durationSec,
            // ThumbnailFileName is a bare filename (e.g. "thumbnail.jpg"), not a URL.
            // getMediaUrls constructs the CDN URL from /{uid}/thumbnail.jpg at read time.
            thumbnailUrl: null,
            readyAt: new Date(),
          },
        }),
        this.prisma.assignment.update({
          where: { id: submission.assignmentId },
          data: { status: 'DONE' },
        }),
      ]);

      this.logger.log(
        `Submission ${submission.id} → READY moderationStatus=${moderationStatus} (duration=${durationSec}s)`,
      );
    } else if (status === BUNNY_STATUS_ERROR || status === BUNNY_STATUS_UPLOAD_FAILED) {
      if (submission.status === 'FAILED') return;
      await this.prisma.submission.update({ where: { id: submission.id }, data: { status: 'FAILED' } });
      this.logger.warn(`Submission ${submission.id} → FAILED (Bunny status=${status})`);
    }
  }

  async handlePaymentWebhook(
    provider: string,
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<void> {
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
      if (event.amount === undefined || Math.round(event.amount) !== payment.amountKz) {
        this.logger.error(
          `Payment webhook amount mismatch for payment ${payment.id}: expected ${payment.amountKz}, got ${event.amount ?? 'none'}`,
        );
        throw new BadRequestException({ code: 'PAYMENT_AMOUNT_MISMATCH' });
      }
      await this.paymentsService.applyPayment(payment.id);
      this.logger.log(`Payment ${payment.id} confirmed via webhook (ref=${event.reference})`);
    } else if (event.status === 'EXPIRED' && payment.status === 'PENDING') {
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'EXPIRED' } });
      this.logger.log(`Payment ${payment.id} expired via webhook (ref=${event.reference})`);
    }
  }
}
