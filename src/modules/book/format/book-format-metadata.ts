import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { Book } from 'src/modules/book/book.model';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { fillBookMetadataFromFileName } from 'src/modules/book/format/book-file-metadata';

export type BookFormatMetadataFields = Pick<
  BookFormatEntity,
  | 'title'
  | 'author'
  | 'genres'
  | 'publishedYear'
  | 'coverImageFileName'
  | 'summary'
  | 'series'
  | 'seriesPosition'
  | 'isbn'
  | 'externalWorkId'
  | 'editionId'
  | 'pageCount'
  | 'publisher'
  | 'language'
>;

export function buildBookFormatMetadata(
  fileMetadata: BookFileMetadata,
  fileName: string,
  coverImageFileName?: string,
): BookFormatMetadataFields {
  const seededMetadata = fillBookMetadataFromFileName({ ...fileMetadata }, fileName);

  return {
    title: seededMetadata.title,
    author: seededMetadata.author,
    genres: seededMetadata.genres,
    publishedYear: seededMetadata.publishedYear,
    coverImageFileName,
    summary: seededMetadata.summary,
    series: seededMetadata.series,
    seriesPosition: seededMetadata.seriesPosition,
    isbn: seededMetadata.isbn,
    externalWorkId: seededMetadata.externalWorkId,
    editionId: seededMetadata.editionId,
    pageCount: seededMetadata.pageCount,
    publisher: seededMetadata.publisher,
    language: seededMetadata.language,
  };
}

export function withBookMetadataFallback(format: BookFormatEntity, book: Book): BookFormatEntity {
  const clonedFormat = Object.assign(new BookFormatEntity(), format);
  Reflect.deleteProperty(clonedFormat, 'book');
  Reflect.deleteProperty(clonedFormat, 'bookId');
  return Object.assign(clonedFormat, {
    title: format.title ?? book.title,
    author: format.author ?? book.author,
    genres: format.genres ?? book.genres,
    publishedYear: format.publishedYear ?? book.publishedYear,
    coverImageFileName: format.coverImageFileName ?? book.coverImageFileName,
    summary: format.summary ?? book.summary,
    series: format.series ?? book.series,
    seriesPosition: format.seriesPosition ?? book.seriesPosition,
    isbn: format.isbn ?? book.isbn,
    externalWorkId: format.externalWorkId ?? book.externalWorkId,
    editionId: format.editionId ?? book.editionId,
    pageCount: format.pageCount ?? book.pageCount,
    publisher: format.publisher ?? book.publisher,
    language: format.language ?? book.language,
  });
}

export function toBookOverridesFromFormat(format: BookFormatEntity): Partial<Book> {
  return {
    title: format.title,
    author: format.author,
    genres: format.genres,
    publishedYear: format.publishedYear,
    coverImageFileName: format.coverImageFileName,
    summary: format.summary,
    series: format.series,
    seriesPosition: format.seriesPosition,
    isbn: format.isbn,
    externalWorkId: format.externalWorkId,
    editionId: format.editionId,
    pageCount: format.pageCount,
    publisher: format.publisher,
    language: format.language,
    fileName: format.fileName,
    fileMtime: format.fileMtime,
    fileContentHash: format.fileContentHash,
  };
}

export function hasStoredFormatMetadata(format: { title?: string; author?: string }): boolean {
  return Boolean(format.title || format.author);
}

export function cloneBookFormat(format: BookFormatEntity, overrides: Partial<BookFormatEntity> = {}): BookFormatEntity {
  const clonedFormat = Object.assign(new BookFormatEntity(), format);
  Reflect.deleteProperty(clonedFormat, 'book');
  Reflect.deleteProperty(clonedFormat, 'bookId');
  return Object.assign(clonedFormat, overrides);
}
