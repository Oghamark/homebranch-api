import { Type } from 'class-transformer';
import { IsEnum, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { CreateBookClubWorkDto } from 'src/modules/book-clubs/dto/create-book-club-work.dto';

export class UpdateBookClubDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string | null;

  @IsOptional()
  @IsEnum(BookClubVisibility)
  visibility?: BookClubVisibility;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateBookClubWorkDto)
  selectedWork?: CreateBookClubWorkDto;
}
