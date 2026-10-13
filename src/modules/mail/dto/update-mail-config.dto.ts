import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateMailConfigDto {
  @IsString()
  @MinLength(1)
  host: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  port: number;

  @IsBoolean()
  secure: boolean;

  @IsOptional()
  @IsString()
  user?: string;

  // Omitted or empty keeps the previously saved password
  @IsOptional()
  @IsString()
  password?: string;

  @IsString()
  @MinLength(3)
  from: string;
}

export class SendTestMailDto {
  @IsEmail()
  to: string;
}
