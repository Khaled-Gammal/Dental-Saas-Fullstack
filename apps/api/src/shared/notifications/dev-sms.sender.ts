import { Logger } from '@nestjs/common';
import { maskPhone } from '../phone';
import type { EmailSender, SmsSender } from './ports';

/**
 * Development SMS: nothing leaves your machine. The text is logged and copied to Mailpit
 * (http://localhost:8025) as an email "to" the phone number, so you can read OTPs there.
 * Swap for a real provider adapter (SMS Misr, Twilio, WhatsApp Cloud API) in production.
 */
export class DevSmsSender implements SmsSender {
  private readonly logger = new Logger('DevSms');
  /** Last message per phone, read by the e2e tests. */
  readonly outbox = new Map<string, string>();

  constructor(private readonly email: EmailSender) {}

  async send(toPhone: string, text: string): Promise<void> {
    this.outbox.set(toPhone, text);
    // never log the body: it contains one-time codes
    this.logger.log(`SMS to ${maskPhone(toPhone)} (read it in Mailpit: http://localhost:8025)`);
    try {
      await this.email.send(`sms-${toPhone.replace('+', '')}@sms.local`, `SMS to ${toPhone}`, text);
    } catch (err) {
      this.logger.warn(`Mailpit not reachable, SMS only logged (${(err as Error).message})`);
    }
  }
}
