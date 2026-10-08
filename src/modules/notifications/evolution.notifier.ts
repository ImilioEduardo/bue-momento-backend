import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Notifier } from './notifier.interface.js';
import { ConsoleNotifier, maskRecipient } from './console.notifier.js';
import { maskPhonesInText, toE164 } from './phone.util.js';

const TIMEOUT_MS = 15_000;

/**
 * "SMS" via WhatsApp, usando uma Evolution API self-hosted (pasta whatsapp-evolution/, fora do backend).
 *
 * Faz POST {EVOLUTION_API_URL}/message/sendText/{EVOLUTION_INSTANCE} com o header `apikey`.
 * EVOLUTION_API_KEY deve ser o token DA INSTÂNCIA (só dá acesso a ela), não a chave global da Evolution.
 * Email ainda não tem fornecedor: delega no ConsoleNotifier.
 *
 * Nunca regista o texto (contém OTPs) nem o número completo.
 */
@Injectable()
export class EvolutionNotifier implements Notifier {
  private readonly logger = new Logger('EvolutionNotifier');

  constructor(
    private readonly config: ConfigService,
    private readonly emailFallback: ConsoleNotifier,
  ) {}

  private get(key: string): string {
    return this.config.get<string>(key) ?? '';
  }

  async sendSms(to: string, text: string): Promise<void> {
    const baseUrl = this.get('EVOLUTION_API_URL').replace(/\/+$/, '');
    const instance = this.get('EVOLUTION_INSTANCE');
    const masked = maskRecipient(to);

    let number: string;
    try {
      // A Evolution quer só dígitos com indicativo: 244944916156
      number = toE164(to, this.get('PHONE_DEFAULT_COUNTRY_CODE') || '244').slice(1);
    } catch {
      throw new ServiceUnavailableException({ code: 'SMS_INVALID_NUMBER', message: 'Número de telemóvel inválido.' });
    }

    let res: Response;
    try {
      res = await fetch(`${baseUrl}/message/sendText/${encodeURIComponent(instance)}`, {
        method: 'POST',
        headers: { apikey: this.get('EVOLUTION_API_KEY'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ number, text, linkPreview: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      // fetch() só diz "TypeError: fetch failed"; a causa real (DNS, porta fechada, TLS) vem em err.cause
      const e = err as Error & { cause?: { code?: string; message?: string } };
      const cause = e.name === 'TimeoutError' ? `timeout ${TIMEOUT_MS / 1000}s` : (e.cause?.code ?? e.cause?.message ?? e.name);
      this.logger.error(`WhatsApp para ${masked} falhou: Evolution inacessivel em ${baseUrl} (${cause})`);
      throw this.deliveryFailed();
    }

    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      // A Evolution responde 400 com {"exists":false,...} quando o número não tem WhatsApp
      if (res.status === 400 && /"exists"\s*:\s*false/.test(raw)) {
        this.logger.warn(`WhatsApp para ${masked}: o número não tem conta WhatsApp`);
        throw new BadRequestException({
          code: 'WHATSAPP_NOT_FOUND',
          message: 'Este número não tem WhatsApp. Confirma o número ou usa o email.',
        });
      }
      const hint =
        res.status === 401 || res.status === 403
          ? ' (EVOLUTION_API_KEY errada?)'
          : res.status === 404
            ? ' (EVOLUTION_INSTANCE não existe?)'
            : /connection closed|not connected|close/i.test(raw)
              ? ' (WhatsApp desligado: lê o QR de novo)'
              : '';
      this.logger.error(
        `WhatsApp para ${masked} recusado pela Evolution: HTTP ${res.status}${hint} ${maskPhonesInText(raw.slice(0, 300))}`,
      );
      throw this.deliveryFailed();
    }

    let id = '?';
    try {
      id = (JSON.parse(raw) as { key?: { id?: string } }).key?.id ?? '?';
    } catch {
      /* resposta sem JSON: aceite na mesma */
    }
    this.logger.log(`WhatsApp para ${masked} aceite pela Evolution (id=${id})`);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    return this.emailFallback.sendEmail(to, subject, html);
  }

  private deliveryFailed() {
    return new ServiceUnavailableException({
      code: 'SMS_DELIVERY_FAILED',
      message: 'Não foi possível enviar o código. Tenta novamente dentro de instantes.',
    });
  }
}
