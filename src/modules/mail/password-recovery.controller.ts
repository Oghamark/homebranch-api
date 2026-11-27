import { Body, Controller, Get, Logger, Post, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, MaxLength } from 'class-validator';
import { createHmac } from 'crypto';
import { MailService } from './mail.service';

class RecoveryRequest {
  @IsEmail()
  @MaxLength(254)
  email: string;
}

@Controller('password-recovery')
export class PasswordRecoveryController {
  private readonly logger = new Logger(PasswordRecoveryController.name);

  constructor(
    private readonly mail: MailService,
    private readonly jwt: JwtService,
  ) {}

  @Get('status')
  async status() {
    return { configured: await this.mail.isConfigured() };
  }

  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async request(@Body() body: RecoveryRequest) {
    if (!(await this.mail.isConfigured())) {
      throw new ServiceUnavailableException('Password recovery is not available');
    }
    const secret = process.env.JWT_ACCESS_SECRET;
    const authUrl = process.env.AUTH_SERVICE_URL;
    const webUrl = process.env.PUBLIC_WEB_URL || process.env.CORS_ORIGIN;
    if (!secret || !authUrl || !webUrl) throw new ServiceUnavailableException('Password recovery is not configured');

    let auth: URL;
    let web: URL;
    try {
      auth = new URL(authUrl);
      web = new URL(webUrl);
      if (
        !['http:', 'https:'].includes(auth.protocol) ||
        auth.username ||
        auth.password ||
        auth.search ||
        auth.hash ||
        !['http:', 'https:'].includes(web.protocol) ||
        web.username ||
        web.password ||
        web.search ||
        web.hash
      ) {
        throw new Error('Invalid URL');
      }
    } catch {
      throw new ServiceUnavailableException('Password recovery is not configured');
    }

    const key = createHmac('sha256', secret).update('homebranch-password-recovery-request').digest();
    const credential = this.jwt.sign(
      { purpose: 'password-recovery-request', email: body.email },
      { secret: key, algorithm: 'HS256', expiresIn: '1m' },
    );
    let token: string;
    try {
      const response = await fetch(`${auth.toString().replace(/\/$/, '')}/password/reset-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Authentication service rejected request');
      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== 'object' ||
        !('token' in result) ||
        typeof result.token !== 'string' ||
        !result.token
      )
        throw new Error('Invalid response');
      token = result.token;
    } catch (error) {
      this.logger.error('Password recovery authentication service is unavailable', error);
      throw new ServiceUnavailableException('Password recovery is unavailable');
    }
    const resetUrl = new URL('reset-password', `${web.toString().replace(/\/$/, '')}/`);
    resetUrl.hash = new URLSearchParams({ token }).toString();
    try {
      await this.mail.send({
        to: body.email,
        subject: 'Reset your Homebranch password',
        text: `If your account uses a local password, use this link to reset it. It expires in 30 minutes:\n\n${resetUrl.toString()}\n\nIf you use an identity provider, contact the provider to reset your password. If you did not request this, you can ignore this email.`,
      });
    } catch (error) {
      this.logger.error('Password recovery email could not be sent', error);
    }
    return { success: true };
  }
}
