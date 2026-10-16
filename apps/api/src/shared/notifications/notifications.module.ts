import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config';
import { DevEmailSender } from './dev-email.sender';
import { DevSmsSender } from './dev-sms.sender';
import { EMAIL_SENDER, SMS_SENDER, type EmailSender, type SmsSender } from './ports';
import { SmtpEmailSender } from './smtp-email.sender';

/** Wires the notification ports to adapters. Import tokens and interfaces from './ports'. */
@Global()
@Module({
  providers: [
    {
      // production talks SMTP directly; development/test keep a copy in memory and survive a stopped Mailpit
      provide: EMAIL_SENDER,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig): EmailSender => (cfg.NODE_ENV === 'production' ? new SmtpEmailSender(cfg) : new DevEmailSender(new SmtpEmailSender(cfg))),
    },
    {
      // one adapter per provider; config.ts refuses SMS_PROVIDER=dev in production
      provide: SMS_SENDER,
      inject: [APP_CONFIG, EMAIL_SENDER],
      useFactory: (cfg: AppConfig, email: EmailSender): SmsSender => {
        switch (cfg.SMS_PROVIDER) {
          case 'dev':
            return new DevSmsSender(email);
          default: {
            const unknown: never = cfg.SMS_PROVIDER; // adding a provider to config.ts forces a decision here
            throw new Error(`No SMS adapter for ${String(unknown)}`);
          }
        }
      },
    },
  ],
  exports: [EMAIL_SENDER, SMS_SENDER],
})
export class NotificationsModule {}
