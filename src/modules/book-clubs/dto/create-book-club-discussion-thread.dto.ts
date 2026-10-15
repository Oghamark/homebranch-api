import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
export class CreateBookClubDiscussionThreadDto {
  @IsString() @Length(1, 160) title: string;
  @IsString() @Length(1, 10000) body: string;
  @IsOptional() @IsBoolean() spoiler?: boolean;
  /** Moderator-only reading or schedule prompt. */
  @IsOptional() @IsBoolean() promptKind?: boolean;
}
