import { IsString, Length } from 'class-validator';

export class TransferBookClubOwnershipDto {
  @IsString()
  @Length(1, 200)
  newOwnerUserId: string;
}
