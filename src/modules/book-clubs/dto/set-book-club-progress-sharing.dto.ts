import { IsBoolean } from 'class-validator';

export class SetBookClubProgressSharingDto {
  @IsBoolean()
  enabled: boolean;
}
