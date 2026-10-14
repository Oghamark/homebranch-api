import { BookClubAssociationMethod } from 'src/modules/book-clubs/book-club.types';

export interface BookClubWorkMatchSource {
  title: string;
  author: string;
  isbn?: string | null;
  externalWorkId?: string | null;
  editionId?: string | null;
  series?: string | null;
  seriesPosition?: number | null;
}

interface MatchableFormat extends Partial<BookClubWorkMatchSource> {
  isbn?: string | null;
  externalWorkId?: string | null;
  editionId?: string | null;
}

interface MatchableBook extends BookClubWorkMatchSource {
  id: string;
  formats?: MatchableFormat[];
}

export type BookClubWorkMatchMethod =
  | BookClubAssociationMethod.IDENTIFIER
  | BookClubAssociationMethod.METADATA_CANDIDATE;

export interface BookClubWorkMatch {
  bookId: string;
  method: BookClubWorkMatchMethod;
  confidence: number;
}

export function matchBookClubWork(work: BookClubWorkMatchSource, books: MatchableBook[]): BookClubWorkMatch[] {
  const matches = books.flatMap((book): BookClubWorkMatch[] => {
    if (hasConflictingWorkIdentifier(work, book)) return [];
    if (hasIdentifierMatch(work, book)) {
      return [{ bookId: book.id, method: BookClubAssociationMethod.IDENTIFIER, confidence: 1 }];
    }

    if (![book, ...(book.formats ?? [])].some((edition) => hasMetadataMatch(work, edition))) return [];
    return [{ bookId: book.id, method: BookClubAssociationMethod.METADATA_CANDIDATE, confidence: 0.75 }];
  });

  return matches.sort((left, right) => right.confidence - left.confidence || left.bookId.localeCompare(right.bookId));
}

function hasConflictingWorkIdentifier(work: BookClubWorkMatchSource, book: MatchableBook): boolean {
  if (!work.externalWorkId) return false;
  return [book, ...(book.formats ?? [])].some(
    (edition) => edition.externalWorkId && !identifiersEqual(work.externalWorkId, edition.externalWorkId),
  );
}

function hasIdentifierMatch(work: BookClubWorkMatchSource, book: MatchableBook): boolean {
  const editions = [book, ...(book.formats ?? [])];
  return editions.some(
    (edition) =>
      identifiersEqual(work.isbn, edition.isbn) ||
      identifiersEqual(work.externalWorkId, edition.externalWorkId) ||
      identifiersEqual(work.editionId, edition.editionId),
  );
}

function identifiersEqual(left?: string | null, right?: string | null): boolean {
  const normalizedLeft = left?.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  const normalizedRight = right?.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function hasMetadataMatch(work: BookClubWorkMatchSource, book: Partial<BookClubWorkMatchSource>): boolean {
  if (!book.title || !book.author) return false;
  const normalizedWorkTitle = normalizeMetadata(work.title);
  const normalizedBookTitle = normalizeMetadata(book.title);
  const normalizedWorkAuthor = normalizeMetadata(work.author);
  const normalizedBookAuthor = normalizeMetadata(book.author);
  if (!normalizedWorkTitle || !normalizedBookTitle || normalizedWorkTitle !== normalizedBookTitle) return false;
  if (!normalizedWorkAuthor || !normalizedBookAuthor || normalizedWorkAuthor !== normalizedBookAuthor) return false;

  if (work.series && book.series && normalizeMetadata(work.series) !== normalizeMetadata(book.series)) return false;
  if (work.seriesPosition != null && book.seriesPosition != null && work.seriesPosition !== book.seriesPosition) {
    return false;
  }
  return true;
}

function normalizeMetadata(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}
