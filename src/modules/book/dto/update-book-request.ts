import { IsNumber, IsOptional, IsString, IsUUID } from 'class-validator';

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
  genres?: string[];

  @IsOptional()
  @IsNumber()
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
  pageCount?: number;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsNumber()
  averageRating?: number;

  @IsOptional()
  @IsNumber()
  ratingsCount?: number;
}
