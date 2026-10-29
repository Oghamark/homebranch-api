import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Request } from 'express';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { accessCredential } from 'src/modules/auth/account-directory.gateway';
import { SocialService } from './social.service';

class AccountDto {
  @IsUUID() userId: string;
}
class SettingsDto {
  @IsOptional() @IsBoolean() allowFriendRequests?: boolean;
  @IsOptional() @IsIn(['anyone', 'friends', 'nobody']) clubInvites?: 'anyone' | 'friends' | 'nobody';
}
class MuteDto {
  @IsBoolean() muted: boolean;
}

@Controller('social')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('people')
  people(@CurrentUser() user: Express.User, @Query('q') query: string, @Req() request: Request) {
    return this.social.search(user.id, query, accessCredential(request));
  }
  @Get('friends')
  friends(@CurrentUser() user: Express.User) {
    return this.social.friends(user.id);
  }
  @Delete('friends/:userId')
  removeFriend(@CurrentUser() user: Express.User, @Param('userId', ParseUUIDPipe) target: string) {
    return this.social.removeFriend(user.id, target);
  }
  @Get('friend-requests')
  requests(@CurrentUser() user: Express.User) {
    return this.social.requests(user.id);
  }
  @Post('friend-requests')
  sendRequest(@CurrentUser() user: Express.User, @Body() input: AccountDto, @Req() request: Request) {
    return this.social.sendFriend(user.id, input.userId, accessCredential(request));
  }
  @Post('friend-requests/:id/accept')
  accept(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.friendAction(user.id, id, 'accept');
  }
  @Post('friend-requests/:id/decline')
  decline(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.friendAction(user.id, id, 'decline');
  }
  @Post('friend-requests/:id/cancel')
  cancel(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.friendAction(user.id, id, 'cancel');
  }
  @Get('settings')
  settings(@CurrentUser() user: Express.User) {
    return this.social.settings(user.id);
  }
  @Patch('settings')
  setSettings(@CurrentUser() user: Express.User, @Body() input: SettingsDto) {
    return this.social.settings(user.id, input);
  }
  @Get('blocks')
  blocks(@CurrentUser() user: Express.User) {
    return this.social.blocks(user.id);
  }
  @Post('blocks')
  block(@CurrentUser() user: Express.User, @Body() input: AccountDto, @Req() request: Request) {
    return this.social.block(user.id, input.userId, accessCredential(request));
  }
  @Delete('blocks/:userId')
  unblock(@CurrentUser() user: Express.User, @Param('userId', ParseUUIDPipe) target: string) {
    return this.social.unblock(user.id, target);
  }
  @Get('club-invitations')
  invitations(@CurrentUser() user: Express.User) {
    return this.social.invitations(user.id);
  }
  @Post('club-invitations/:id/accept')
  acceptInvitation(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.invitationAction(user.id, id, 'accept');
  }
  @Post('club-invitations/:id/decline')
  declineInvitation(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.invitationAction(user.id, id, 'decline');
  }
}

@Controller('book-clubs/:clubId')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class ClubSocialController {
  constructor(private readonly social: SocialService) {}

  @Get('invitations')
  list(@CurrentUser() user: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.social.invitations(user.id, clubId);
  }
  @Post('invitations')
  send(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() input: AccountDto,
    @Req() request: Request,
  ) {
    return this.social.sendInvitation(user.id, clubId, input.userId, accessCredential(request));
  }
  @Post('invitations/:id/cancel')
  cancel(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.social.invitationAction(user.id, id, 'cancel', clubId);
  }
  @Get('activity-preference')
  preference(@CurrentUser() user: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.social.activityPreference(user.id, clubId);
  }
  @Put('activity-preference')
  setPreference(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() input: MuteDto,
  ) {
    return this.social.activityPreference(user.id, clubId, input.muted);
  }
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly social: SocialService) {}

  @Get()
  list(
    @CurrentUser() user: Express.User,
    @Req() request: Request,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.social.notifications(
      user.id,
      page === undefined ? 1 : Number(page),
      limit === undefined ? 20 : Number(limit),
      accessCredential(request),
    );
  }
  @Get('unread-count')
  async count(@CurrentUser() user: Express.User) {
    const result = await this.social.notifications(user.id, 1, 1);
    return { count: result.unreadCount };
  }
  @Post('read-all')
  readAll(@CurrentUser() user: Express.User) {
    return this.social.notificationAction(user.id, 'read-all');
  }
  @Post(':id/read')
  read(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.notificationAction(user.id, 'read', id);
  }
  @Delete(':id')
  dismiss(@CurrentUser() user: Express.User, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.notificationAction(user.id, 'dismiss', id);
  }
}
