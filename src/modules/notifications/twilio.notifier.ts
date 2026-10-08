import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notifier } from './notifier.interface.js';
import { ConsoleNotifier, maskRecipient } from './console.notifier.js';
import { maskPhonesInText, toE164 } from './phone.util.js';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const TIMEOUT_MS = 10_000;

interface TwilioMessageResponse {
  sid?: string;
  status?: string;
  code?: number;
  message?: string;
}

/**
 * SMS via Twilio Programmable Messaging (REST, sem SDK).
 * Autenticação: API Key (recomendado) ou Account SID + Auth Token.
 * Remetente: Messaging Service (recomendado) ou número/ID alfanumérico em TWILIO_SMS_FROM.
 * Email ainda não tem fornecedor: delega no ConsoleNotifier (que em produção não regista conteúdo).
 *
 * Nunca regista o corpo da mensagem (contém OTPs) nem o número completo.
 */
@Injectable()
export class TwilioNotifier implements Notifier {
  private readonly logger = new Logger('TwilioNotifier');

  constructor(
    private readonly config: ConfigService,
    private readonly emailFallback: ConsoleNotifier,
  ) {}

  private get(key: string): string {
    return this.config.get<string>(key) ?? '';
  }

  async sendSms(to: string, text: string): Promise<void> {
    const accountSid = this.get('TWILIO_ACCOUNT_SID');
    const username = this.get('TWILIO_API_KEY_SID') || accountSid;
    const password = this.get('TWILIO_API_KEY_SECRET') || this.get('TWILIO_AUTH_TOKEN');
    const messagingServiceSid = this.get('TWILIO_MESSAGING_SERVICE_SID');
    const from = this.get('TWILIO_SMS_FROM');
    const masked = maskRecipient(to);

    let e164: string;
    try {
      e164 = toE164(to, this.get('TWILIO_DEFAULT_COUNTRY_CODE') || '244');
    } catch {
      throw new ServiceUnavailableException({ code: 'SMS_INVALID_NUMBER', message: 'Número de telemóvel inválido.' });
    }

    const form = new URLSearchParams({ To: e164, Body: text });
    if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
    else form.set('From', from);

    let res: Response;
    try {
      res = await fetch(`${TWILIO_API}/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      this.logger.error(`SMS para ${masked} falhou (rede/timeout): ${(err as Error).name}`);
      throw this.deliveryFailed();
    }

    const data = (await res.json().catch(() => ({}))) as TwilioMessageResponse;
    if (!res.ok) {
      // Códigos úteis: 21211 número inválido, 21408 país sem permissão (Geo Permissions),
      // 21608 conta trial e número não verificado, 20003 credenciais erradas.
      this.logger.error(
        `SMS para ${masked} recusado pelo Twilio: HTTP ${res.status} code=${data.code ?? '?'} ${maskPhonesInText(data.message ?? '')}`,
      );
      throw this.deliveryFailed();
    }

    this.logger.log(`SMS para ${masked} aceite pelo Twilio (sid=${data.sid}, status=${data.status})`);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    return this.emailFallback.sendEmail(to, subject, html);
  }

  private deliveryFailed() {
    return new ServiceUnavailableException({
      code: 'SMS_DELIVERY_FAILED',
      message: 'Não foi possível enviar o SMS. Tenta novamente dentro de instantes.',
    });
  }
}
