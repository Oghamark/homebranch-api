import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
export class CreateBookClubDiscussionReplyDto {
  @IsString() @Length(1, 10000) body: string;
  @IsOptional() @IsBoolean() spoiler?: boolean;
}
