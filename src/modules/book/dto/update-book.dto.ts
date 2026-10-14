export class UpdateBookDto {
  title?: string;
  author?: string;
  isFavorite?: boolean;
  publishedYear?: number;
  summary?: string;
  genres?: string[];
  series?: string;
  seriesPosition?: number;
  isbn?: string;
  externalWorkId?: string;
  editionId?: string;
  pageCount?: number;
  publisher?: string;
  language?: string;
  averageRating?: number;
  ratingsCount?: number;
}
