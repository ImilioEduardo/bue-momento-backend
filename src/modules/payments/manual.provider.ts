import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { IPaymentProvider, PaymentEvent, PaymentReference } from './payment-provider.interface.js';

const REFERENCE_TTL_HOURS = 72;
const MULTICAIXA_ENTITY = '00060';

@Injectable()
export class ManualProvider implements IPaymentProvider {
  readonly providerName = 'manual';

  async createReference(_amountKz: number, _description: string): Promise<PaymentReference> {
    return {
      entity: MULTICAIXA_ENTITY,
      reference: randomBytes(4).toString('hex').toUpperCase(),
      expiresAt: new Date(Date.now() + REFERENCE_TTL_HOURS * 3_600_000),
    };
  }

  // Manual provider has no real webhook — admin confirms via POST /admin/payments/:id/confirm
  verifyWebhook(_rawBody: Buffer, _headers: Record<string, string>): PaymentEvent {
    throw new Error('ManualProvider does not support webhooks — use admin confirmation.');
  }
}
