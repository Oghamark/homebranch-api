import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsUUID, ValidateIf, ValidateNested } from 'class-validator';
import { BookClubMilestoneDto, UpdateBookClubScheduleDto } from './update-book-club-schedule.dto';

export class PatchBookClubMilestoneDto extends BookClubMilestoneDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsUUID()
  id?: string;
}

export class PatchBookClubScheduleDto extends UpdateBookClubScheduleDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => PatchBookClubMilestoneDto)
  declare milestones?: PatchBookClubMilestoneDto[];
}
