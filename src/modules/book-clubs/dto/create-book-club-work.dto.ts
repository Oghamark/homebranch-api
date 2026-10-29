import { IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateBookClubWorkDto {
  @IsString()
  @Length(1, 300)
  title: string;

  @IsString()
  @Length(1, 300)
  author: string;

  @IsOptional()
  @IsString()
  @Length(1, 32)
  isbn?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  externalWorkId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  editionId?: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  series?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  seriesPosition?: number;
}
