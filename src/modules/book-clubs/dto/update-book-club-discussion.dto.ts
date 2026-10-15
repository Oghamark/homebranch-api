import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
export class UpdateBookClubDiscussionDto {
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsString() @Length(1, 10000) body?: string;
  @IsOptional() @IsBoolean() spoiler?: boolean;
}
