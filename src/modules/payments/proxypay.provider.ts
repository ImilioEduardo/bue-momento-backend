import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import type { IPaymentProvider, PaymentEvent, PaymentReference } from './payment-provider.interface.js';

const PROXYPAY_BASE_URL = 'https://api.proxypay.co.ao';
const REFERENCE_TTL_HOURS = 72;
const MULTICAIXA_ENTITY = '00060';

interface ProxyPayReferenceResponse {
  id: string;
}

interface ProxyPayWebhookBody {
  id: string;
  amount?: number;
  datetime?: string;
  event_type?: string;
}

@Injectable()
export class ProxyPayProvider implements IPaymentProvider {
  private readonly logger = new Logger(ProxyPayProvider.name);
  readonly providerName = 'proxypay';

  constructor(private readonly config: ConfigService) {}

  private get apiKey() {
    return this.config.get<string>('PROXYPAY_API_KEY') ?? '';
  }

  private get webhookSecret() {
    return this.config.get<string>('PROXYPAY_WEBHOOK_SECRET') ?? '';
  }

  async createReference(amountKz: number, _description: string): Promise<PaymentReference> {
    const expiresAt = new Date(Date.now() + REFERENCE_TTL_HOURS * 3_600_000);

    if (!this.apiKey) {
      this.logger.warn('PROXYPAY_API_KEY not configured — using dev fallback reference');
      return {
        entity: MULTICAIXA_ENTITY,
        reference: Math.random().toString().slice(2, 12),
        expiresAt,
      };
    }

    const res = await fetch(`${PROXYPAY_BASE_URL}/references`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ amount: amountKz, end_datetime: expiresAt.toISOString() }),
    });

    if (!res.ok) {
      throw new Error(`ProxyPay API error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as ProxyPayReferenceResponse;
    return { entity: MULTICAIXA_ENTITY, reference: data.id, expiresAt };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): PaymentEvent {
    const body = JSON.parse(rawBody.toString('utf8')) as ProxyPayWebhookBody;
    const secret = this.webhookSecret;

    if (secret) {
      const sig = headers['x-proxypay-signature'] ?? headers['x-signature'] ?? '';
      const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
      if (sig !== expected) {
        throw new UnauthorizedException({ code: 'PROXYPAY_SIGNATURE_INVALID' });
      }
    } else if (this.apiKey) {
      // Fallback: verify Basic auth header matches API key
      const authHeader = headers['authorization'] ?? '';
      const expectedAuth = `Basic ${Buffer.from(`${this.apiKey}:`).toString('base64')}`;
      if (authHeader !== expectedAuth) {
        throw new UnauthorizedException({ code: 'PROXYPAY_AUTH_INVALID' });
      }
    }

    const isExpiry = body.event_type === 'expiry';
    return {
      reference: body.id,
      status: isExpiry ? 'EXPIRED' : 'PAID',
      paidAt: isExpiry ? undefined : (body.datetime ? new Date(body.datetime) : new Date()),
    };
  }
}
