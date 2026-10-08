import { Injectable, Logger } from '@nestjs/common';
import { Notifier } from './notifier.interface.js';

const isProduction = () => process.env['NODE_ENV'] === 'production';

/** "+244912345678" → "+244•••••678"; "ana@x.com" → "a•••@x.com" */
export function maskRecipient(to: string): string {
  if (to.includes('@')) {
    const [user, domain] = to.split('@');
    return `${user.slice(0, 1)}•••@${domain}`;
  }
  return to.length > 7 ? `${to.slice(0, 4)}•••••${to.slice(-3)}` : '•••';
}

/**
 * Notifier de desenvolvimento: escreve as mensagens no log para testar localmente.
 * Em produção NUNCA escreve o conteúdo (que contém OTPs) nem o destinatário completo.
 * (O aviso de "nada está a ser entregue" é emitido no NotificationsModule.)
 */
@Injectable()
export class ConsoleNotifier implements Notifier {
  private readonly logger = new Logger('ConsoleNotifier');

  async sendSms(to: string, text: string): Promise<void> {
    if (isProduction()) {
      this.logger.warn(`SMS para ${maskRecipient(to)} NÃO entregue (sem fornecedor configurado).`);
      return;
    }
    this.logger.log(`[DEV] 📱 SMS → ${to}: ${text}`);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (isProduction()) {
      this.logger.warn(`Email para ${maskRecipient(to)} NÃO entregue (sem fornecedor configurado).`);
      return;
    }
    this.logger.log(`[DEV] 📧 EMAIL → ${to} | ${subject} | ${html.replace(/<[^>]+>/g, ' ')}`);
  }
}
