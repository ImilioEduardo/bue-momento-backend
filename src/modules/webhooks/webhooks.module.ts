import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { MediaModule } from '../media/media.module.js';
import { PaymentsModule } from '../payments/payments.module.js';

@Module({
  imports: [MediaModule, PaymentsModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
