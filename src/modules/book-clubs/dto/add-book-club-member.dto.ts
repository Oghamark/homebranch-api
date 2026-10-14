import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { BookClubRole } from 'src/modules/book-clubs/book-club.types';

export class AddBookClubMemberDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @IsIn([BookClubRole.MEMBER, BookClubRole.MODERATOR])
  role?: BookClubRole.MEMBER | BookClubRole.MODERATOR;
}
