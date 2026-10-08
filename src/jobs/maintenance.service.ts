import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { StreamClient } from '../modules/media/stream.client.js';
import { StorageClient } from '../modules/media/storage.client.js';
import { NOTIFIER } from '../modules/notifications/notifier.interface.js';
import type { Notifier } from '../modules/notifications/notifier.interface.js';

const PAYMENT_TTL_HOURS = 72;
const EXPIRY_WARN_DAYS = 7;

// Prisma error codes for connectivity failures (Neon compute paused, etc.)
const DB_UNREACHABLE_CODES = new Set(['P1001', 'P1002']);

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamClient,
    private readonly storage: StorageClient,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {}

  // Close events whose submission window has passed (endsAt + graceHours <= now)
  @Cron('*/15 * * * *')
  async closeEvents(): Promise<void> {
    await this.safely('closeEvents', async () => {
      const result = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE "Event"
        SET status = 'CLOSED'
        WHERE status = 'ACTIVE'
          AND ("endsAt" + CAST("graceHours" AS INTEGER) * INTERVAL '1 hour') <= NOW()
      `);
      if (result > 0) this.logger.log(`Closed ${result} events`);
    });
  }

  // Expire events + delete all media (Stream videos, R2 photos/ZIPs)
  @Cron('0 3 * * *') // 03:00 UTC daily
  async expireEvents(): Promise<void> {
    await this.safely('expireEvents', async () => {
      const toExpire = await this.prisma.event.findMany({
        where: { status: 'CLOSED', expiresAt: { lte: new Date() } },
        select: { id: true, name: true },
      });

      if (toExpire.length === 0) return;

      for (const event of toExpire) {
        try {
          // Delete all submission media
          const submissions = await this.prisma.submission.findMany({
            where: { assignment: { guest: { eventId: event.id } } },
            select: { streamUid: true, r2Key: true },
          });
          for (const sub of submissions) {
            if (sub.streamUid) await this.stream.deleteVideo(sub.streamUid).catch((e: Error) => this.logger.warn(`deleteVideo ${sub.streamUid}: ${e.message}`));
            if (sub.r2Key) await this.storage.deleteObject(sub.r2Key).catch((e: Error) => this.logger.warn(`deleteObject ${sub.r2Key}: ${e.message}`));
          }

          // Delete export ZIPs
          const exports = await this.prisma.export.findMany({
            where: { eventId: event.id },
            select: { r2Key: true },
          });
          for (const exp of exports) {
            if (exp.r2Key) await this.storage.deleteObject(exp.r2Key).catch(() => {});
          }

          await this.prisma.event.update({
            where: { id: event.id },
            data: { status: 'EXPIRED' },
          });

          this.logger.log(`Expired event ${event.id} "${event.name}" — deleted ${submissions.length} media items`);
        } catch (err) {
          this.logger.error(`Failed to expire event ${event.id}: ${(err as Error).message}`);
        }
      }
    });
  }

  // Notify organizers 7 days before their event expires (daily at 08:00 UTC)
  @Cron('0 8 * * *')
  async warnExpiry(): Promise<void> {
    await this.safely('warnExpiry', async () => {
      const now = new Date();
      const windowStart = new Date(now.getTime() + (EXPIRY_WARN_DAYS - 1) * 86_400_000);
      const windowEnd = new Date(now.getTime() + (EXPIRY_WARN_DAYS + 1) * 86_400_000);

      const events = await this.prisma.event.findMany({
        where: {
          status: { in: ['ACTIVE', 'CLOSED'] },
          expiresAt: { gte: windowStart, lte: windowEnd },
        },
        include: { organizer: { select: { name: true, email: true, phone: true } } },
      });

      for (const event of events) {
        const org = event.organizer;
        const body = `Olá ${org.name}, o teu evento "${event.name}" expira em aproximadamente 7 dias. Após essa data todos os vídeos e fotos serão apagados permanentemente.`;
        try {
          if (org.email) await this.notifier.sendEmail(org.email, 'O teu evento expira em breve — Bué Momentos', `<p>${body}</p>`);
          if (org.phone) await this.notifier.sendSms(org.phone, body);
        } catch (err) {
          this.logger.warn(`Failed to send expiry warning for event ${event.id}: ${(err as Error).message}`);
        }
      }

      if (events.length > 0) this.logger.log(`Sent expiry warnings for ${events.length} events`);
    });
  }

  // Expire pending payment references older than 72h
  @Cron('0 * * * *')
  async expireReferences(): Promise<void> {
    await this.safely('expireReferences', async () => {
      const cutoff = new Date(Date.now() - PAYMENT_TTL_HOURS * 3_600_000);
      const result = await this.prisma.payment.updateMany({
        where: { status: 'PENDING', createdAt: { lte: cutoff } },
        data: { status: 'EXPIRED' },
      });
      if (result.count > 0) this.logger.log(`Expired ${result.count} payment references`);
    });
  }

  // Limpeza de sessões e códigos antigos (diariamente às 04:00 UTC)
  @Cron('0 4 * * *')
  async purgeAuthData(): Promise<void> {
    await this.safely('purgeAuthData', async () => {
      const now = Date.now();
      const [tokens, otps] = await Promise.all([
        this.prisma.refreshToken.deleteMany({
          where: {
            OR: [
              { expiresAt: { lt: new Date(now) } },
              { revokedAt: { lt: new Date(now - 7 * 86_400_000) } },
            ],
          },
        }),
        this.prisma.otpCode.deleteMany({ where: { createdAt: { lt: new Date(now - 2 * 86_400_000) } } }),
      ]);
      if (tokens.count + otps.count > 0) {
        this.logger.log(`purgeAuthData: ${tokens.count} refresh tokens, ${otps.count} OTPs removidos`);
      }
    });
  }

  private async safely(job: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code && DB_UNREACHABLE_CODES.has(code)) {
        // Neon compute paused or network blip — not an app error, will retry next interval
        this.logger.warn(`${job}: database unreachable (${code}), skipping — will retry next interval`);
      } else {
        this.logger.error(`${job} failed: ${(err as Error).message}`, (err as Error).stack);
      }
    }
  }
}
