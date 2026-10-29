import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { BookClubProgressStatus } from 'src/modules/book-clubs/entities/book-club-milestone-progress.entity';

export class SetBookClubMilestoneProgressDto {
  @IsEnum(BookClubProgressStatus)
  status: BookClubProgressStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  percentage?: number | null;
}
