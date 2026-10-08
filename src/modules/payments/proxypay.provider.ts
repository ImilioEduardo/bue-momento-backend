import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomInt } from 'crypto';
import { safeEqual } from '../../common/security/safe-compare.js';
import type { IPaymentProvider, PaymentEvent, PaymentReference } from './payment-provider.interface.js';

const PROXYPAY_BASE_URL = 'https://api.proxypay.co.ao';
const REFERENCE_TTL_HOURS = 72;
const MULTICAIXA_ENTITY = '00060';

interface ProxyPayReferenceResponse {
  id: string;
}

interface ProxyPayWebhookBody {
  id?: string | number;
  reference_id?: string | number;
  amount?: number | string;
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
        reference: String(randomInt(1_000_000_000, 10_000_000_000)),
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

  // Falha fechado: sem segredo não se aceita nenhum webhook.
  // A assinatura (HMAC-SHA256 do corpo bruto) é verificada ANTES de interpretar o JSON.
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): PaymentEvent {
    const secret = this.webhookSecret || this.apiKey;
    if (!secret) {
      throw new UnauthorizedException({ code: 'PROXYPAY_WEBHOOK_NOT_CONFIGURED' });
    }

    const sig = String(headers['x-signature'] ?? headers['x-proxypay-signature'] ?? '').trim().toLowerCase();
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!sig || !safeEqual(sig, expected)) {
      throw new UnauthorizedException({ code: 'PROXYPAY_SIGNATURE_INVALID' });
    }

    let body: ProxyPayWebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as ProxyPayWebhookBody;
    } catch {
      throw new BadRequestException({ code: 'WEBHOOK_BODY_INVALID' });
    }

    const reference = String(body.reference_id ?? body.id ?? '');
    if (!reference) throw new BadRequestException({ code: 'WEBHOOK_REFERENCE_MISSING' });

    const isExpiry = body.event_type === 'expiry';
    const amount = body.amount != null ? Number(body.amount) : undefined;
    return {
      reference,
      status: isExpiry ? 'EXPIRED' : 'PAID',
      paidAt: isExpiry ? undefined : (body.datetime ? new Date(body.datetime) : new Date()),
      amount: Number.isFinite(amount) ? amount : undefined,
    };
  }
}
