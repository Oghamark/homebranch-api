import { Module } from '@nestjs/common';
import { AuthModule } from 'src/modules/auth/auth.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { MailController } from 'src/modules/mail/mail.controller';
import { MailService } from 'src/modules/mail/mail.service';

@Module({
  imports: [AuthModule, SettingsModule],
  providers: [MailService],
  controllers: [MailController],
  exports: [MailService],
})
export class MailModule {}
