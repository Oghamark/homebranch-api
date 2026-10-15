import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { BookClubMilestoneKind } from 'src/modules/book-clubs/entities/book-club-milestone.entity';

export class BookClubMilestoneDto {
  @IsString()
  @Length(1, 120)
  name: string;

  @IsEnum(BookClubMilestoneKind)
  kind: BookClubMilestoneKind;

  @IsInt()
  @Min(1)
  position: number;
}

export class UpdateBookClubScheduleDto {
  @IsOptional()
  @IsDateString({ strict: true })
  startDate?: string | null;

  @IsOptional()
  @IsDateString({ strict: true })
  completionDate?: string | null;

  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BookClubMilestoneDto)
  milestones?: BookClubMilestoneDto[];
}
