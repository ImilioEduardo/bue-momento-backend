export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface PaymentReference {
  entity: string;
  reference: string;
  expiresAt: Date;
}

export interface PaymentEvent {
  reference: string;
  status: 'PAID' | 'EXPIRED';
  paidAt?: Date;
}

export interface IPaymentProvider {
  readonly providerName: string;
  createReference(amountKz: number, description: string): Promise<PaymentReference>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): PaymentEvent;
}
