import { IsString, Length } from 'class-validator';

export class CreateBookClubWorkDto {
  @IsString()
  @Length(1, 300)
  title: string;

  @IsString()
  @Length(1, 300)
  author: string;
}
