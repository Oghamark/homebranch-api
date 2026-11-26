import { IsArray, IsNumber, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class UpdateBookRequest {
  @IsUUID()
  id: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsNumber()
  @Min(1)
  publishedYear?: number;

  @IsOptional()
  isFavorite?: boolean;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsString()
  series?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  seriesPosition?: number;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  externalWorkId?: string;

  @IsOptional()
  @IsString()
  editionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  pageCount?: number;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  averageRating?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  ratingsCount?: number;
}
