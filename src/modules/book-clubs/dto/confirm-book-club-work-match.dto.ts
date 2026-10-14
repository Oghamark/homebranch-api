import { IsUUID } from 'class-validator';

export class ConfirmBookClubWorkMatchDto {
  @IsUUID()
  bookId: string;
}
