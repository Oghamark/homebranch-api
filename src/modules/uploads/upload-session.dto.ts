import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class UploadFileDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  size: number;
}

export class CreateUploadSessionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => UploadFileDto)
  files: UploadFileDto[];
}

export class UploadedBookDto {
  @IsUUID()
  uploadId: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsBoolean()
  isFavorite?: boolean;
}

export class UploadedAudiobookPreviewDto {
  @IsUUID()
  uploadId: string;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  relativePaths: string[];
}
