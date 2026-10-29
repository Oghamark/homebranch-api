import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PaginationResult } from 'src/common/core/pagination_result';
import { OpenLibraryGateway, type BookCoverCandidate } from 'src/common/gateways/open-library.gateway';
import { CompositeMetadataGateway } from 'src/modules/book/metadata/gateways/composite-metadata.gateway';
import { CompositeSummaryGateway } from 'src/modules/book/metadata/gateways/composite-summary.gateway';
import { GetBooksRequest } from 'src/modules/book/dto/get-books-request';
import { Book, copyBook } from 'src/modules/book/book.model';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { getDefaultBookFormatType, getRequestedBookFormatFromBook } from 'src/modules/book/format/book-format';
import { BookPersistenceService, WorkBookIdentifiers } from 'src/modules/book/persistence/book.persistence';
import { isCloudMode } from 'src/common/utils/cloud';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

export interface DownloadBookResult {
  book: Book;
  format: BookFormatType;
  fileName: string;
}

@Injectable()
export class BookService {
  constructor(
    private readonly bookPersistenceService: BookPersistenceService,
    private readonly metadataGateway: CompositeMetadataGateway,
    private readonly summaryGateway: CompositeSummaryGateway,
    private readonly openLibraryGateway: OpenLibraryGateway,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  async getBooks({
    limit,
    offset,
    query,
    userId,
    viewerUserId,
    isbn,
    genre,
    series,
    author,
  }: GetBooksRequest): Promise<PaginationResult<Book[]>> {
    const hasFilters = query || isbn || genre || series || author;

    if (hasFilters) {
      return this.bookPersistenceService.searchBooksWithFilters(
        { query, isbn, genre, series, author },
        limit,
        offset,
        userId,
        viewerUserId,
      );
    }

    return this.bookPersistenceService.findBooks(limit, offset, userId, viewerUserId);
  }

  async getCurrentUserBooks(request: GetBooksRequest, currentUserId: string): Promise<PaginationResult<Book[]>> {
    return this.getBooks({
      ...request,
      userId: currentUserId,
      viewerUserId: currentUserId,
    });
  }

  async getNewArrivals(limit?: number, offset?: number, ownerScope?: string): Promise<PaginationResult<Book[]>> {
    return this.bookPersistenceService.findNewArrivals(limit, offset, ownerScope);
  }

  async getGenres(ownerScope?: string): Promise<string[]> {
    return this.bookPersistenceService.findGenres(ownerScope);
  }

  async getFavoriteBooks({
    query,
    limit,
    offset,
    userId,
    isbn,
    genre,
    series,
    author,
  }: GetBooksRequest): Promise<PaginationResult<Book[]>> {
    const hasFilters = query || isbn || genre || series || author;

    if (hasFilters) {
      return this.bookPersistenceService.searchFavoriteBooksWithFilters(
        { query, isbn, genre, series, author },
        limit,
        offset,
        userId,
      );
    }

    return this.bookPersistenceService.findFavoriteBooks(limit, offset, userId);
  }

  async getBookById(id: string, viewerUserId?: string, ownerScope?: string): Promise<Book> {
    return this.bookPersistenceService.findBookById(id, viewerUserId, ownerScope);
  }

  async getMatchingBooks(work: WorkBookIdentifiers, userId: string): Promise<Book[]> {
    return this.bookPersistenceService.findMatchingBooksForWork(work, isCloudMode() ? userId : undefined);
  }

  /** Throws NotFound when ownerScope is set and the book is not owned by that user. */
  async assertAccess(id: string, ownerScope?: string): Promise<void> {
    if (ownerScope) {
      await this.bookPersistenceService.findBookById(id, undefined, ownerScope);
    }
  }

  async toggleFavorite(userId: string, bookId: string): Promise<{ isFavorite: boolean }> {
    return this.bookPersistenceService.toggleBookFavorite(userId, bookId);
  }

  async deleteBook(id: string, requestingUserId: string, isAdmin: boolean): Promise<Book> {
    const book = await this.bookPersistenceService.findBookById(id);

    if (!isAdmin && book.uploadedByUserId !== undefined && book.uploadedByUserId !== requestingUserId) {
      throw new ForbiddenException('Only the uploader or an admin can delete this book');
    }

    return this.bookPersistenceService.permanentDeleteBook(id);
  }

  async assignBookOwner(id: string, ownerId: string | null, isAdmin: boolean): Promise<Book> {
    this.ensureAdmin(isAdmin);

    const book = await this.bookPersistenceService.findBookById(id);
    book.uploadedByUserId = ownerId ?? undefined;

    return this.bookPersistenceService.updateBookRecord(book.id, book);
  }

  async bulkAssignBookOwner(bookIds: string[], ownerId: string | null, isAdmin: boolean) {
    this.ensureAdmin(isAdmin);

    const results = await Promise.allSettled(bookIds.map((bookId) => this.assignBookOwner(bookId, ownerId, isAdmin)));
    const assigned = results.filter((result) => result.status === 'fulfilled').length;

    return {
      assigned,
      failed: results.length - assigned,
      total: results.length,
    };
  }

  async fetchBookMetadata(id: string): Promise<Book> {
    const book = await this.bookPersistenceService.findBookById(id);
    const enrichedBook = await this.metadataGateway.enrichBook(book);

    return this.bookPersistenceService.updateBookRecord(id, enrichedBook);
  }

  async searchBookCovers(id: string, query?: string): Promise<BookCoverCandidate[]> {
    const book = await this.bookPersistenceService.findBookById(id);
    return this.openLibraryGateway.searchBookCovers(book.title, book.author, query);
  }

  async selectBookCover(id: string, coverId: number): Promise<Book> {
    const book = await this.bookPersistenceService.findBookById(id);
    const { buffer, mimeType } = await this.openLibraryGateway.fetchBookCover(coverId);
    const extension = mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
    const coverImageFileName = `${randomUUID()}${extension}`;
    await this.storage.uploadFile(buffer, {
      key: `cover-images/${coverImageFileName}`,
      mimeType,
    });

    return this.bookPersistenceService.updateBookRecord(
      id,
      copyBook(book, { coverImageFileName, metadataUpdatedAt: new Date() }),
    );
  }

  async fetchBookSummary(id: string): Promise<Book> {
    const book = await this.bookPersistenceService.findBookById(id);
    const summary = await this.summaryGateway.fetchSummary(book);

    if (!summary) {
      return book;
    }

    book.summary = summary;
    return this.bookPersistenceService.updateBookRecord(id, book);
  }

  async getDownload(id: string, format?: BookFormatType, ownerScope?: string): Promise<DownloadBookResult> {
    const book = await this.bookPersistenceService.findBookById(id, undefined, ownerScope);
    const selectedFormat = getRequestedBookFormatFromBook(book, format);

    if (!selectedFormat) {
      throw new BadRequestException(`Format "${format ?? getDefaultBookFormatType()}" is not available for this book`);
    }

    return {
      book,
      format: selectedFormat.format,
      fileName: selectedFormat.fileName,
    };
  }

  private ensureAdmin(isAdmin: boolean): void {
    if (!isAdmin) {
      throw new ForbiddenException('Only an admin can assign a book owner');
    }
  }
}
