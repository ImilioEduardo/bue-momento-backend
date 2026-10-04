import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { EventsController } from './events.controller.js';
import { EventsService } from './events.service.js';
import { EventLimitsService } from './events-limits.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { MediaModule } from '../media/media.module.js';

@Module({
  imports: [
    AuthModule,
    PaymentsModule,
    MediaModule,
    BullModule.registerQueue({ name: 'exports' }),
  ],
  controllers: [EventsController],
  providers: [EventsService, EventLimitsService],
  exports: [EventLimitsService],
})
export class EventsModule {}
