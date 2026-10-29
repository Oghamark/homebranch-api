import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class SetBookClubMilestoneMappingDto {
  @IsString()
  @Length(1, 120)
  memberLabel: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  memberPosition?: number | null;
}
