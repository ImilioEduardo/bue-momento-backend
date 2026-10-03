export interface Notifier {
  sendSms(to: string, text: string): Promise<void>;
  sendEmail(to: string, subject: string, html: string): Promise<void>;
}

export const NOTIFIER = 'NOTIFIER';
