import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateBookRequest {
  @IsOptional()
  @IsString({ message: 'Invalid title' })
  title?: string;

  @IsOptional()
  @IsString({ message: 'Invalid author' })
  author?: string;

  @IsOptional()
  isFavorite?: boolean;

  @IsOptional()
  genres?: string[];

  @IsOptional()
  @IsString({ message: 'Invalid Published Year' })
  publishedYear?: string;

  @IsOptional()
  @IsString()
  filePath?: string;

  @IsOptional()
  @IsString()
  coverImagePath?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  originalFileName?: string;

  @IsOptional()
  @IsString()
  coverImageFileName?: string;

  uploadedByUserId: string;

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
