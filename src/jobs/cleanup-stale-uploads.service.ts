import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service.js';
import { StreamClient } from '../modules/media/stream.client.js';
import { StorageClient } from '../modules/media/storage.client.js';

const STALE_AFTER_HOURS = 12;

@Injectable()
export class CleanupStaleUploadsService {
  private readonly logger = new Logger(CleanupStaleUploadsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stream: StreamClient,
    private readonly storage: StorageClient,
  ) {}

  @Cron('0 * * * *') // Every hour at :00
  async run(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_AFTER_HOURS * 60 * 60 * 1000);

    const stale = await this.prisma.submission.findMany({
      where: { status: 'UPLOADING', createdAt: { lt: cutoff } },
      select: { id: true, streamUid: true, r2Key: true },
    });

    if (stale.length === 0) return;

    this.logger.log(`cleanup-stale-uploads: found ${stale.length} stale submissions`);

    let cleaned = 0;
    for (const s of stale) {
      try {
        if (s.streamUid) await this.stream.deleteVideo(s.streamUid);
        if (s.r2Key) await this.storage.deleteObject(s.r2Key);
        await this.prisma.submission.update({
          where: { id: s.id },
          data: { status: 'FAILED' },
        });
        cleaned++;
      } catch (err) {
        this.logger.error(`Failed to clean stale upload ${s.id}: ${(err as Error).message}`);
      }
    }

    this.logger.log(`cleanup-stale-uploads: cleaned ${cleaned}/${stale.length}`);
  }
}
