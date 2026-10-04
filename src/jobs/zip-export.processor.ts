import { Inject, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { Readable } from 'stream';
import { ZipArchive } from 'archiver';
import type { ArchiverError } from 'archiver';
import { PrismaService } from '../prisma/prisma.service.js';
import { StreamClient } from '../modules/media/stream.client.js';
import { StorageClient } from '../modules/media/storage.client.js';
import { NOTIFIER } from '../modules/notifications/notifier.interface.js';
import type { Notifier } from '../modules/notifications/notifier.interface.js';

export interface ZipExportJob {
  exportId: string;
  eventId: string;
}

@Processor('exports')
export class ZipExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ZipExportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamClient,
    private readonly storage: StorageClient,
    @Inject(NOTIFIER) private readonly notifier: Notifier,
  ) {
    super();
  }

  async process(job: Job<ZipExportJob>): Promise<void> {
    const { exportId, eventId } = job.data;

    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'PROCESSING' },
    });

    try {
      await this.buildZip(job, exportId, eventId);
    } catch (err) {
      this.logger.error(`Export ${exportId} failed: ${(err as Error).message}`);
      await this.prisma.export.update({
        where: { id: exportId },
        data: { status: 'FAILED' },
      });
      throw err;
    }
  }

  private async buildZip(job: Job<ZipExportJob>, exportId: string, eventId: string): Promise<void> {
    const submissions = await this.prisma.submission.findMany({
      where: {
        status: 'READY',
        moderationStatus: 'APPROVED',
        assignment: { guest: { eventId } },
      },
      include: {
        assignment: {
          include: {
            challenge: { select: { text: true } },
            guest: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const r2Key = `events/${eventId}/exports/${exportId}.zip`;

    if (submissions.length === 0) {
      await this.prisma.export.update({
        where: { id: exportId },
        data: { status: 'READY', r2Key },
      });
      return;
    }

    // Pipe archive output stream directly into S3 multipart upload — ≤512 MB RAM
    const archive = new ZipArchive({ zlib: { level: 6 } });

    const uploadPromise = this.storage.streamUpload(r2Key, archive, 'application/zip');

    archive.on('warning', (err: ArchiverError) => {
      if (err.code !== 'ENOENT') this.logger.warn(`Archiver warning: ${err.message}`);
    });

    let processed = 0;
    for (const sub of submissions) {
      const slug = (s: string) =>
        s.slice(0, 30).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_');
      const ext = sub.mediaType === 'VIDEO' ? 'mp4' : this.photoExt(sub.r2Key ?? '');
      const filename = `${String(processed + 1).padStart(3, '0')}_${slug(sub.assignment.guest.name)}_${slug(sub.assignment.challenge.text)}.${ext}`;

      try {
        const url = sub.r2Key
          ? await this.storage.presignGetUrl(sub.r2Key, 3600)
          : await this.stream.getMp4DownloadUrl(sub.streamUid!);

        const response = await fetch(url);
        if (!response.ok || !response.body) {
          this.logger.warn(`Skipping submission ${sub.id}: HTTP ${response.status}`);
          continue;
        }

        // Convert Web ReadableStream to Node.js Readable (Node 18+ API)
        const readable = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
        archive.append(readable, { name: filename });
        processed++;
      } catch (err) {
        this.logger.warn(`Skipping submission ${sub.id}: ${(err as Error).message}`);
      }

      await job.updateProgress(Math.round((processed / submissions.length) * 90));
    }

    await archive.finalize();
    await uploadPromise;

    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'READY', r2Key },
    });

    this.logger.log(`Export ${exportId} complete — ${processed} files at ${r2Key}`);

    // Notify the organizer that the ZIP is ready (fire-and-forget)
    this.prisma.event.findUnique({
      where: { id: eventId },
      include: { organizer: { select: { name: true, email: true, phone: true } } },
    }).then((event) => {
      if (!event?.organizer) return;
      const org = event.organizer;
      const msg = `Olá ${org.name}, o ZIP do teu evento "${event.name}" está pronto para descarregar.`;
      return Promise.all([
        org.email ? this.notifier.sendEmail(org.email, 'ZIP pronto — Bué Momentos', `<p>${msg}</p>`) : Promise.resolve(),
        org.phone ? this.notifier.sendSms(org.phone, msg) : Promise.resolve(),
      ]);
    }).catch(() => {});
  }

  private photoExt(r2Key: string): string {
    const m = r2Key.match(/\.(\w+)$/);
    return m ? m[1] : 'jpg';
  }
}
