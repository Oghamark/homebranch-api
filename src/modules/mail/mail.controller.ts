import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { MailService } from 'src/modules/mail/mail.service';
import { SendTestMailDto, UpdateMailConfigDto } from 'src/modules/mail/dto/update-mail-config.dto';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mailService: MailService) {}

  @Get('config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async getConfig() {
    const smtp = await this.mailService.getSmtpConfig();
    return {
      configured: await this.mailService.isConfigured(),
      smtp: smtp ? { ...smtp, password: undefined, hasPassword: !!smtp.password } : null,
    };
  }

  @Put('config')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async updateConfig(@Body() dto: UpdateMailConfigDto) {
    const existing = await this.mailService.getSmtpConfig();
    await this.mailService.saveSmtpConfig({
      host: dto.host,
      port: dto.port,
      secure: dto.secure,
      user: dto.user || undefined,
      password: dto.password || existing?.password,
      from: dto.from,
    });
    return this.getConfig();
  }

  @Post('test')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async sendTest(@Body() dto: SendTestMailDto) {
    await this.mailService.send({
      to: dto.to,
      subject: 'Homebranch test email',
      text: 'Your Homebranch email settings are working.',
    });
    return { success: true };
  }

  /** Lets any signed-in user learn which sender to approve in their Amazon account. */
  @Get('sender')
  async getSender() {
    return { configured: await this.mailService.isConfigured(), sender: await this.mailService.getSenderAddress() };
  }
}
