import { IsDefined, IsEnum, IsOptional, IsString, Length, MaxLength, ValidateNested } from 'class-validator';
import { BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { CreateBookClubWorkDto } from 'src/modules/book-clubs/dto/create-book-club-work.dto';
import { Type } from 'class-transformer';

export class CreateBookClubDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  description?: string;

  @IsEnum(BookClubVisibility)
  visibility: BookClubVisibility;

  @IsDefined()
  @ValidateNested()
  @Type(() => CreateBookClubWorkDto)
  selectedWork: CreateBookClubWorkDto;
}
