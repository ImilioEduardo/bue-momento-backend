import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleNotifier } from './console.notifier.js';
import { EvolutionNotifier } from './evolution.notifier.js';
import { NOTIFIER } from './notifier.interface.js';
import type { Notifier } from './notifier.interface.js';

@Global()
@Module({
  providers: [
    ConsoleNotifier,
    EvolutionNotifier,
    {
      provide: NOTIFIER,
      inject: [ConfigService, ConsoleNotifier, EvolutionNotifier],
      useFactory: (
        config: ConfigService,
        consoleNotifier: ConsoleNotifier,
        evolution: EvolutionNotifier,
      ): Notifier => {
        const logger = new Logger('Notifications');
        const isProd = (config.get<string>('NODE_ENV') ?? 'production') === 'production';
        const smsProvider = config.get<string>('SMS_PROVIDER') ?? 'console';

        if (isProd && smsProvider === 'console') {
          logger.error('SMS_PROVIDER=console em produção: nenhum código será entregue (os OTPs não chegam aos utilizadores).');
        }
        if (isProd && (config.get<string>('EMAIL_PROVIDER') ?? 'console') === 'console') {
          logger.warn('EMAIL_PROVIDER=console em produção: os emails (incl. OTP por email) não são entregues.');
        }
        logger.log(smsProvider === 'evolution' ? 'Códigos via WhatsApp (Evolution API)' : `SMS via ${smsProvider}`);
        if (smsProvider === 'evolution') return evolution;
        return consoleNotifier;
      },
    },
  ],
  exports: [NOTIFIER],
})
export class NotificationsModule {}
