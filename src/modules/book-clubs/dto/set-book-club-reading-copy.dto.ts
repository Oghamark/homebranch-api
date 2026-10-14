import { IsEnum, IsUUID } from 'class-validator';
import { BookClubReadingCopySource } from 'src/modules/book-clubs/book-club.types';

export class SetBookClubReadingCopyDto {
  @IsEnum({
    SHARED: BookClubReadingCopySource.SHARED,
    PERSONAL: BookClubReadingCopySource.PERSONAL,
  })
  source: BookClubReadingCopySource.SHARED | BookClubReadingCopySource.PERSONAL;

  @IsUUID()
  bookId: string;
}
