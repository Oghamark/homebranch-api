import { IsArray, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateBookDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  isFavorite?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  publishedYear?: number;

  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  genres?: string[];

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
