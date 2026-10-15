import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';
export class CreateBookClubDiscussionReplyDto {
  @IsString() @Length(1, 10000) body: string;
  @ValidateIf((_object, value) => value !== undefined) @IsBoolean() spoiler?: boolean;
}
