import { Body, Controller, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { WebhooksService } from './webhooks.service.js';
import type { StreamWebhookPayload } from './webhooks.service.js';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('stream')
  @HttpCode(200)
  async handleStream(
    @Req() req: Request,
    @Body() body: Record<string, unknown>,
    @Headers('webhook-signature') signature: string | undefined,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    this.webhooks.verifyStreamSignature(rawBody, signature);
    await this.webhooks.handleStreamEvent(body as unknown as StreamWebhookPayload);
    return { ok: true };
  }

  @Post('payments/:provider')
  @HttpCode(200)
  async handlePayment(
    @Req() req: Request,
    @Body() _body: Record<string, unknown>,
    @Param('provider') provider: string,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0);
    await this.webhooks.handlePaymentWebhook(
      provider,
      rawBody,
      req.headers as Record<string, string>,
    );
    return { ok: true };
  }
}
