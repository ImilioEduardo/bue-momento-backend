import { Injectable, Logger } from '@nestjs/common';
import { Notifier } from './notifier.interface.js';

@Injectable()
export class ConsoleNotifier implements Notifier {
  private readonly logger = new Logger('ConsoleNotifier');

  async sendSms(to: string, text: string): Promise<void> {
    this.logger.log(`📱 SMS → ${to}: ${text}`);
  }

  async sendEmail(to: string, subject: string, html: string): Promise<void> {
    this.logger.log(`📧 EMAIL → ${to} | ${subject}`);
  }
}
