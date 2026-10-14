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
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

@Controller('book-clubs')
@UseGuards(JwtAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
export class BookClubsController {
  constructor(private readonly bookClubsService: BookClubsService) {}

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

  @Get(':clubId')
  getClub(@CurrentUser() currentUser: Express.User, @Param('clubId', ParseUUIDPipe) clubId: string) {
    return this.bookClubsService.getClub(clubId, currentUser.id);
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
