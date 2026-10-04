import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CleanupStaleUploadsService } from './cleanup-stale-uploads.service.js';
import { MaintenanceService } from './maintenance.service.js';
import { ZipExportProcessor } from './zip-export.processor.js';
import { MediaModule } from '../modules/media/media.module.js';

@Module({
  imports: [
    MediaModule,
    BullModule.registerQueue({ name: 'exports' }),
  ],
  providers: [CleanupStaleUploadsService, MaintenanceService, ZipExportProcessor],
})
export class JobsModule {}
