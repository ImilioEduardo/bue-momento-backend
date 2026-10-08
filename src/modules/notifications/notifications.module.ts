import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConsoleNotifier } from './console.notifier.js';
import { TwilioNotifier } from './twilio.notifier.js';
import { NOTIFIER } from './notifier.interface.js';
import type { Notifier } from './notifier.interface.js';

@Global()
@Module({
  providers: [
    ConsoleNotifier,
    TwilioNotifier,
    {
      provide: NOTIFIER,
      inject: [ConfigService, ConsoleNotifier, TwilioNotifier],
      useFactory: (config: ConfigService, consoleNotifier: ConsoleNotifier, twilio: TwilioNotifier): Notifier => {
        const logger = new Logger('Notifications');
        const isProd = (config.get<string>('NODE_ENV') ?? 'production') === 'production';
        const smsProvider = config.get<string>('SMS_PROVIDER') ?? 'console';

        if (isProd && smsProvider === 'console') {
          logger.error('SMS_PROVIDER=console em produção: nenhum SMS será entregue (os OTPs não chegam aos utilizadores).');
        }
        if (isProd && (config.get<string>('EMAIL_PROVIDER') ?? 'console') === 'console') {
          logger.warn('EMAIL_PROVIDER=console em produção: os emails (incl. OTP por email) não são entregues.');
        }
        logger.log(`SMS via ${smsProvider}`);
        return smsProvider === 'twilio' ? twilio : consoleNotifier;
      },
    },
  ],
  exports: [NOTIFIER],
})
export class NotificationsModule {}
