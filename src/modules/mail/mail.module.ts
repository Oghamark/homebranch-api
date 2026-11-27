import { Module } from '@nestjs/common';
import { AuthModule } from 'src/modules/auth/auth.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { MailController } from 'src/modules/mail/mail.controller';
import { MailService } from 'src/modules/mail/mail.service';
import { PasswordRecoveryController } from './password-recovery.controller';
import { ThrottlerModule } from '@nestjs/throttler';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [AuthModule, SettingsModule, JwtModule.register({}), ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
  providers: [MailService],
  controllers: [MailController, PasswordRecoveryController],
  exports: [MailService],
})
export class MailModule {}
