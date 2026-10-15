import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { AddBookClubMemberDto } from 'src/modules/book-clubs/dto/add-book-club-member.dto';
import { CreateBookClubDto } from 'src/modules/book-clubs/dto/create-book-club.dto';
import { TransferBookClubOwnershipDto } from 'src/modules/book-clubs/dto/transfer-book-club-ownership.dto';
import { UpdateBookClubMemberDto } from 'src/modules/book-clubs/dto/update-book-club-member.dto';
import { UpdateBookClubDto } from 'src/modules/book-clubs/dto/update-book-club.dto';
import { SetBookClubReadingCopyDto } from 'src/modules/book-clubs/dto/set-book-club-reading-copy.dto';
import { ConfirmBookClubWorkMatchDto } from 'src/modules/book-clubs/dto/confirm-book-club-work-match.dto';
import { UpdateBookClubScheduleDto } from 'src/modules/book-clubs/dto/update-book-club-schedule.dto';
import { SetBookClubMilestoneProgressDto } from 'src/modules/book-clubs/dto/set-book-club-milestone-progress.dto';
import { SetBookClubMilestoneMappingDto } from 'src/modules/book-clubs/dto/set-book-club-milestone-mapping.dto';
import { SetBookClubProgressSharingDto } from 'src/modules/book-clubs/dto/set-book-club-progress-sharing.dto';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubDiscussionService, ModerationAction } from 'src/modules/book-clubs/book-club-discussion.service';
import { CreateBookClubDiscussionThreadDto } from 'src/modules/book-clubs/dto/create-book-club-discussion-thread.dto';
import { CreateBookClubDiscussionReplyDto } from 'src/modules/book-clubs/dto/create-book-club-discussion-reply.dto';
import { UpdateBookClubDiscussionDto } from 'src/modules/book-clubs/dto/update-book-club-discussion.dto';

@Controller('book-clubs')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class BookClubsController {
  constructor(
    private readonly bookClubsService: BookClubsService,
    private readonly discussions: BookClubDiscussionService,
  ) {}

  @Get()
  listClubs(@CurrentUser() currentUser: Express.User) {
    return this.bookClubsService.listClubs(currentUser.id);
  }

  @Post()
  createClub(@CurrentUser() currentUser: Express.User, @Body() dto: CreateBookClubDto) {
    return this.bookClubsService.createClub(currentUser.id, dto);
  }

  @Post(':clubId/join')
  async joinClub(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    const membership = await this.bookClubsService.joinClub(clubId, currentUser.id);
    return this.membershipResponse(membership);
  }

  @Get(':clubId/discussions')
  listDiscussions(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Query('revealSpoilers') reveal?: string,
  ) {
    return this.discussions.listThreads(clubId, user.id, reveal === 'true');
  }

  @Post(':clubId/discussions')
  createDiscussion(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: CreateBookClubDiscussionThreadDto,
  ) {
    return this.discussions.createThread(clubId, user.id, dto);
  }

  @Patch(':clubId/discussions/:threadId')
  editDiscussion(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: UpdateBookClubDiscussionDto,
  ) {
    return this.discussions.editThread(clubId, threadId, user.id, dto);
  }

  @Delete(':clubId/discussions/:threadId')
  @HttpCode(204)
  deleteDiscussion(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
  ) {
    return this.discussions.deleteOwnThread(clubId, threadId, user.id);
  }

  @Get(':clubId/discussions/:threadId/replies')
  listDiscussionReplies(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Query('revealSpoilers') reveal?: string,
  ) {
    return this.discussions.listReplies(clubId, threadId, user.id, reveal === 'true');
  }
  @Post(':clubId/discussions/:threadId/replies')
  createDiscussionReply(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: CreateBookClubDiscussionReplyDto,
  ) {
    return this.discussions.createReply(clubId, threadId, user.id, dto);
  }
  @Patch(':clubId/discussion-replies/:replyId')
  editDiscussionReply(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Body() dto: CreateBookClubDiscussionReplyDto,
  ) {
    return this.discussions.editReply(clubId, replyId, user.id, dto);
  }
  @Delete(':clubId/discussion-replies/:replyId')
  @HttpCode(204)
  deleteDiscussionReply(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
  ) {
    return this.discussions.deleteOwnReply(clubId, replyId, user.id);
  }

  @Post(':clubId/discussions/:threadId/moderation/:action')
  @HttpCode(204)
  moderateDiscussion(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Param('action') action: ModerationAction,
  ) {
    return this.discussions.moderateThread(clubId, threadId, user.id, action);
  }
  @Post(':clubId/discussion-replies/:replyId/moderation/:action')
  @HttpCode(204)
  moderateDiscussionReply(
    @CurrentUser() user: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('replyId', ParseUUIDPipe) replyId: string,
    @Param('action') action: Exclude<ModerationAction, 'lock' | 'unlock' | 'pin' | 'unpin'>,
  ) {
    return this.discussions.moderateReply(clubId, replyId, user.id, action);
  }
  @Get(':clubId/discussion-audit')
  discussionAudit(@CurrentUser() user: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.discussions.getAudit(clubId, user.id);
  }

  @Get(':clubId')
  getClub(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.bookClubsService.getClub(clubId, currentUser.id);
  }

  @Get(':clubId/schedule')
  getSchedule(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.bookClubsService.getSchedule(clubId, currentUser.id);
  }

  @Put(':clubId/schedule')
  updateSchedule(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: UpdateBookClubScheduleDto,
  ) {
    return this.bookClubsService.updateSchedule(clubId, currentUser.id, dto);
  }

  @Put(':clubId/progress-sharing')
  setProgressSharing(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: SetBookClubProgressSharingDto,
  ) {
    return this.bookClubsService.setProgressSharing(clubId, currentUser.id, dto.enabled);
  }

  @Put(':clubId/milestones/:milestoneId/mapping')
  setMilestoneMapping(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: SetBookClubMilestoneMappingDto,
  ) {
    return this.bookClubsService.setMilestoneMapping(clubId, milestoneId, currentUser.id, dto);
  }

  @Delete(':clubId/milestones/:milestoneId/mapping')
  @HttpCode(204)
  clearMilestoneMapping(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
  ) {
    return this.bookClubsService.clearMilestoneMapping(clubId, milestoneId, currentUser.id);
  }

  @Put(':clubId/milestones/:milestoneId/progress')
  setMilestoneProgress(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('milestoneId', ParseUUIDPipe) milestoneId: string,
    @Body() dto: SetBookClubMilestoneProgressDto,
  ) {
    return this.bookClubsService.setMilestoneProgress(clubId, milestoneId, currentUser.id, dto);
  }

  @Get(':clubId/works/:workId/reading-copy')
  getReadingCopy(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('workId', ParseUUIDPipe) workId: string,
  ) {
    return this.bookClubsService.getReadingCopy(clubId, workId, currentUser.id);
  }

  @Get(':clubId/works/:workId/reading-copy/matches')
  getWorkMatchCandidates(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('workId', ParseUUIDPipe) workId: string,
  ) {
    return this.bookClubsService.getWorkMatchCandidates(clubId, workId, currentUser.id);
  }

  @Post(':clubId/works/:workId/reading-copy/matches/confirm')
  confirmWorkMatch(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() dto: ConfirmBookClubWorkMatchDto,
  ) {
    return this.bookClubsService.confirmWorkMatch(clubId, workId, currentUser.id, dto.bookId);
  }

  @Put(':clubId/works/:workId/reading-copy')
  setReadingCopy(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('workId', ParseUUIDPipe) workId: string,
    @Body() dto: SetBookClubReadingCopyDto,
  ) {
    return this.bookClubsService.setReadingCopy(clubId, workId, currentUser.id, dto);
  }

  @Delete(':clubId/works/:workId/reading-copy')
  @HttpCode(204)
  clearReadingCopy(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('workId', ParseUUIDPipe) workId: string,
  ) {
    return this.bookClubsService.clearReadingCopy(clubId, workId, currentUser.id);
  }

  @Patch(':clubId')
  updateClub(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: UpdateBookClubDto,
  ) {
    return this.bookClubsService.updateClub(clubId, currentUser.id, dto);
  }

  @Post(':clubId/members')
  async addMember(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: AddBookClubMemberDto,
  ) {
    const membership = await this.bookClubsService.addMember(clubId, currentUser.id, dto);
    return this.membershipResponse(membership);
  }

  @Patch(':clubId/members/:userId')
  async updateMemberRole(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdateBookClubMemberDto,
  ) {
    const membership = await this.bookClubsService.updateMemberRole(clubId, currentUser.id, userId, dto.role);
    return this.membershipResponse(membership);
  }

  @Delete(':clubId/members/:userId')
  async removeMember(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.bookClubsService.removeMember(clubId, currentUser.id, userId);
  }

  @Post(':clubId/transfer-ownership')
  transferOwnership(
    @CurrentUser() currentUser: Express.User,
    @Param('clubId', ParseUUIDPipe) clubId: string,
    @Body() dto: TransferBookClubOwnershipDto,
  ) {
    return this.bookClubsService.transferOwnership(clubId, currentUser.id, dto.newOwnerUserId);
  }

  @Post(':clubId/archive')
  archiveClub(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.bookClubsService.archiveClub(clubId, currentUser.id);
  }

  @Delete(':clubId')
  @HttpCode(204)
  deleteClub(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.bookClubsService.deleteClub(clubId, currentUser.id);
  }

  private membershipResponse(member: BookClubMemberEntity) {
    return {
      id: member.id,
      clubId: member.clubId,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
    };
  }
}
