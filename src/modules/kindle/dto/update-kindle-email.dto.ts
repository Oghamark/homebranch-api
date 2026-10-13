import { IsEmail, IsOptional } from 'class-validator';

export class UpdateKindleEmailDto {
  // null clears the saved address
  @IsOptional()
  @IsEmail()
  kindleEmail?: string | null;
}
