import { Global, Module } from '@nestjs/common';
import { ConsoleNotifier } from './console.notifier.js';
import { NOTIFIER } from './notifier.interface.js';

@Global()
@Module({
  providers: [{ provide: NOTIFIER, useClass: ConsoleNotifier }],
  exports: [NOTIFIER],
})
export class NotificationsModule {}
