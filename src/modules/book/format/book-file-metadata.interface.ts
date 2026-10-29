export interface BookFileMetadata {
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  publishedYear?: number;
  isbn?: string;
  externalWorkId?: string;
  editionId?: string;
  summary?: string;
  genres?: string[];
  series?: string;
  seriesPosition?: number;
  pageCount?: number;
  coverImageBuffer?: Buffer;
  coverImageMimeType?: string;
}
