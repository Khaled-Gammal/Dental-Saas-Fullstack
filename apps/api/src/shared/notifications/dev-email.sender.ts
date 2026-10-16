import { Logger } from '@nestjs/common';
import type { EmailSender } from './ports';

/**
 * Development email: delivers through SMTP (Mailpit) when it is up, keeps the last message per recipient in memory
 * for the e2e tests, and never throws, so a stopped Mailpit cannot fail a sign-up or a booking.
 */
export class DevEmailSender implements EmailSender {
  private readonly logger = new Logger('DevEmail');
  /** Last message per recipient, read by the e2e tests. */
  readonly outbox = new Map<string, { subject: string; text: string }>();

  constructor(private readonly smtp: EmailSender) {}

  async send(to: string, subject: string, text: string): Promise<void> {
    this.outbox.set(to.toLowerCase(), { subject, text });
    try {
      await this.smtp.send(to, subject, text);
    } catch (err) {
      this.logger.warn(`Mailpit not reachable, email to ${to} only kept in memory (${(err as Error).message})`);
    }
  }
}
