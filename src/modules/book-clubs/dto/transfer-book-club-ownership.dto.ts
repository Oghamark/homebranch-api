import { IsUUID } from 'class-validator';

export class TransferBookClubOwnershipDto {
  @IsUUID()
  newOwnerUserId: string;
}
