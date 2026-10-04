import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManualProvider } from './manual.provider.js';
import { ProxyPayProvider } from './proxypay.provider.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDER } from './payment-provider.interface.js';
import type { IPaymentProvider } from './payment-provider.interface.js';

@Module({
  providers: [
    ManualProvider,
    ProxyPayProvider,
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, ManualProvider, ProxyPayProvider],
      useFactory: (
        config: ConfigService,
        manual: ManualProvider,
        proxypay: ProxyPayProvider,
      ): IPaymentProvider => {
        return config.get<string>('PAYMENT_PROVIDER') === 'proxypay' ? proxypay : manual;
      },
    },
  ],
  exports: [PAYMENT_PROVIDER, PaymentsService],
})
export class PaymentsModule {}
