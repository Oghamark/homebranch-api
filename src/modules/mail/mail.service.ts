import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { decryptSecret, encryptSecret } from 'src/common/utils/secret-crypto';
import { SettingsService } from 'src/modules/settings/settings.service';

export const MAIL_SMTP_SETTING_KEY = 'mail.smtp';

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
}

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly settingsService: SettingsService) {}

  async getSmtpConfig(): Promise<SmtpConfig | null> {
    const raw = await this.settingsService.getOptionalValue(MAIL_SMTP_SETTING_KEY);
    if (!raw) {
      return null;
    }
    try {
      const config = JSON.parse(raw) as SmtpConfig;
      return { ...config, password: config.password ? decryptSecret(config.password) : undefined };
    } catch {
      return null;
    }
  }

  async saveSmtpConfig(config: SmtpConfig): Promise<void> {
    const stored = { ...config, password: config.password ? encryptSecret(config.password) : undefined };
    await this.settingsService.upsert(MAIL_SMTP_SETTING_KEY, JSON.stringify(stored));
  }

  /** The sender address users must approve in their Amazon account. */
  async getSenderAddress(): Promise<string | null> {
    return (await this.getSmtpConfig())?.from ?? null;
  }

  async isConfigured(): Promise<boolean> {
    return !!(await this.getSmtpConfig());
  }

  async send(input: MailInput): Promise<void> {
    const smtp = await this.getSmtpConfig();
    if (!smtp) {
      throw new ServiceUnavailableException('Email is not configured. Ask an administrator to set up email.');
    }
    const transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password ?? '' } : undefined,
      connectionTimeout: 15000,
      socketTimeout: 60000,
    });
    try {
      await transport.sendMail({
        from: smtp.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        attachments: input.attachments,
      });
    } catch (error) {
      this.logger.error(`SMTP send failed: ${String(error)}`);
      throw new ServiceUnavailableException('Could not send email. Check the SMTP configuration.');
    } finally {
      transport.close();
    }
  }
}
