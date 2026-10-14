import { IsIn } from 'class-validator';
import { BookClubRole } from 'src/modules/book-clubs/book-club.types';

export class UpdateBookClubMemberDto {
  @IsIn([BookClubRole.MEMBER, BookClubRole.MODERATOR])
  role: BookClubRole.MEMBER | BookClubRole.MODERATOR;
}
