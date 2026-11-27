import { PaginatedQuery } from 'src/common/core/paginated-query';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class GetBooksRequest extends PaginatedQuery {
  userId?: string;
  viewerUserId?: string;
  isbn?: string;
  genre?: string;
  series?: string;
  author?: string;

  @IsOptional()
  @IsString()
  genreFilter?: string;

  @IsOptional()
  @IsString()
  seriesFilter?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearFrom?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  yearTo?: number;

  @IsOptional()
  @IsIn(['title', 'author', 'publishedYear'])
  sortBy?: 'title' | 'author' | 'publishedYear';

  @IsOptional()
  @IsIn(['ASC', 'DESC'])
  sortDirection?: 'ASC' | 'DESC';
}
