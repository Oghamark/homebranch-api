import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { BookClubRole } from 'src/modules/book-clubs/book-club.types';

export class AddBookClubMemberDto {
  @IsString()
  @Length(1, 200)
  userId: string;

  @IsOptional()
  @IsIn([BookClubRole.MEMBER, BookClubRole.MODERATOR])
  role?: BookClubRole.MEMBER | BookClubRole.MODERATOR;
}
