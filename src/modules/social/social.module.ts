import { Module } from '@nestjs/common';
import { AuthModule } from 'src/modules/auth/auth.module';
import { ClubSocialController, NotificationsController, SocialController } from './social.controller';
import { SocialService } from './social.service';

@Module({
  imports: [AuthModule],
  providers: [SocialService],
  controllers: [SocialController, ClubSocialController, NotificationsController],
  exports: [SocialService],
})
export class SocialModule {}
