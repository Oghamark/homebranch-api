import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
export class UpdateBookClubDiscussionDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 160) title?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Length(1, 10000) body?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() spoiler?: boolean;
}
