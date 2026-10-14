/** Ports: business code depends on these, never on a provider SDK (SRS 8.3, Strategy + Adapter). */
export interface EmailSender {
  send(to: string, subject: string, text: string): Promise<void>;
}
export interface SmsSender {
  send(toPhone: string, text: string): Promise<void>;
}
export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const SMS_SENDER = Symbol('SMS_SENDER');
