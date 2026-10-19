import { Inject, Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { APP_CONFIG, type AppConfig } from '../../config';
import { rtlHtml } from './arabic-mail';
import type { EmailSender } from './ports';

/** SMTP adapter (Mailpit in development). Every email goes as plain text plus its right-to-left HTML (L10N-004). */
@Injectable()
export class SmtpEmailSender implements EmailSender {
  private readonly transport: Transporter;
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.transport = createTransport({ host: cfg.SMTP_HOST, port: cfg.SMTP_PORT, secure: false });
  }

  async send(to: string, subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.cfg.MAIL_FROM, to, subject, text, html: rtlHtml(text) });
  }
}
