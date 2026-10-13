import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { PaginationResult } from 'src/common/core/pagination_result';
import { Book } from 'src/modules/book/book.model';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { UserBookFavoriteEntity } from 'src/modules/book/user-book-favorite.entity';
import { BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

export interface BookSearchFilters {
  query?: string;
  isbn?: string;
  genre?: string;
  series?: string;
  author?: string;
}

@Injectable()
export class BookPersistenceService {
  constructor(
    @InjectRepository(BookEntity) private readonly bookRepository: Repository<BookEntity>,
    @InjectRepository(BookFormatEntity) private readonly formatRepository: Repository<BookFormatEntity>,
    @InjectRepository(UserBookFavoriteEntity)
    private readonly favoriteRepository: Repository<UserBookFavoriteEntity>,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  normalizeBookEntity(bookEntity: BookEntity): Book {
    return normalizeBookEntity(bookEntity);
  }

  createBookRecord(entity: Book): Promise<Book> {
    return createBookRecord(this.bookRepository, entity);
  }

  findBooks(
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<PaginationResult<Book[]>> {
    return findBooks(
      this.bookRepository,
      this.formatRepository,
      limit,
      offset,
      userId,
      viewerUserId,
      this.favoriteRepository,
    );
  }

  findNewArrivals(limit?: number, offset?: number, ownerScope?: string): Promise<PaginationResult<Book[]>> {
    return findNewArrivals(this.bookRepository, this.formatRepository, limit, offset, ownerScope);
  }

  findGenres(ownerScope?: string): Promise<string[]> {
    return findGenres(this.bookRepository, ownerScope);
  }

  findFavoriteBooks(limit?: number, offset?: number, userId?: string): Promise<PaginationResult<Book[]>> {
    return findFavoriteBooks(this.bookRepository, this.formatRepository, limit, offset, userId);
  }

  searchBooksWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
    viewerUserId?: string,
  ): Promise<PaginationResult<Book[]>> {
    return searchBooksWithFilters(
      this.bookRepository,
      this.formatRepository,
      filters,
      limit,
      offset,
      userId,
      viewerUserId,
      this.favoriteRepository,
    );
  }

  searchFavoriteBooksWithFilters(
    filters: BookSearchFilters,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<PaginationResult<Book[]>> {
    return searchFavoriteBooksWithFilters(this.bookRepository, this.formatRepository, filters, limit, offset, userId);
  }

  findBookById(id: string, viewerUserId?: string, ownerId?: string): Promise<Book> {
    return findBookById(
      this.bookRepository,
      this.bookFormatProcessingService,
      id,
      viewerUserId,
      this.favoriteRepository,
      ownerId,
    );
  }

  findBookByFileName(fileName: string, includeDeleted = false): Promise<Book | null> {
    return findBookByFileName(this.bookRepository, fileName, includeDeleted);
  }

  findBookByContentHash(hash: string, includeDeleted = false, ownerId?: string): Promise<Book | null> {
    return findBookByContentHash(this.bookRepository, hash, includeDeleted, ownerId);
  }

  findAllActiveBooks(): Promise<Book[]> {
    return findAllActiveBooks(this.bookRepository);
  }

  findUnownedBooks(limit?: number, offset?: number): Promise<PaginationResult<Book[]>> {
    return findUnownedBooks(this.bookRepository, this.formatRepository, limit, offset);
  }

  findOrphanedBooks(knownUserIds: string[], limit?: number, offset?: number): Promise<PaginationResult<Book[]>> {
    return findOrphanedBooks(this.bookRepository, this.formatRepository, knownUserIds, limit, offset);
  }

  searchBooksByAuthorAndTitle(
    author: string,
    title: string,
    limit?: number,
    offset?: number,
    userId?: string,
  ): Promise<PaginationResult<Book[]>> {
    return searchBooksByAuthorAndTitle(
      this.bookRepository,
      this.formatRepository,
      author,
      title,
      limit,
      offset,
      userId,
    );
  }

  findBooksWithoutMetadata(limit: number): Promise<Book[]> {
    return findBooksWithoutMetadata(this.bookRepository, this.formatRepository, limit);
  }

  toggleBookFavorite(userId: string, bookId: string): Promise<{ isFavorite: boolean }> {
    return toggleBookFavorite(this.favoriteRepository, userId, bookId);
  }

  updateBookRecord(id: string, book: Book): Promise<Book> {
    return updateBookRecord(this.bookRepository, this.formatRepository, this.bookFormatProcessingService, id, book);
  }

  splitBookFormatRecord(bookId: string, updatedBook: Book, splitBook: Book): Promise<Book> {
    return splitBookFormatRecord(
      this.bookRepository,
      this.formatRepository,
      this.bookFormatProcessingService,
      bookId,
      updatedBook,
      splitBook,
    );
  }

  permanentDeleteBook(id: string): Promise<Book> {
    return permanentDeleteBook(this.bookRepository, id, this.storage);
  }

  softDeleteBookRecord(id: string): Promise<Book> {
    return softDeleteBookRecord(this.bookRepository, this.formatRepository, id);
  }

  restoreBookRecord(id: string): Promise<Book> {
    return restoreBookRecord(this.bookRepository, this.formatRepository, id);
  }

  updateStoredBookContentHash(id: string, hash: string): Promise<void> {
    return updateStoredBookContentHash(this.bookRepository, id, hash);
  }
}

export function normalizeBookEntity(bookEntity: BookEntity): Book {
  const book = Object.assign(new BookEntity(), bookEntity);
  Reflect.deleteProperty(book, 'bookShelves');
  book.formats = bookEntity.formats?.map((format) => cloneFormatEntity(format));
  return book;
}

export async function createBookRecord(repository: Repository<BookEntity>, entity: Book): Promise<Book> {
  const bookEntity = toBookEntity(entity);
  const savedEntity = await repository.save(bookEntity);
  return normalizeBookEntity(savedEntity);
}

export async function findBooks(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  limit?: number,
  offset?: number,
  userId?: string,
  viewerUserId?: string,
  favoriteRepository?: Repository<UserBookFavoriteEntity>,
): Promise<PaginationResult<Book[]>> {
  const [bookEntities, total] = await repository.findAndCount({
    where: userId ? { uploadedByUserId: userId, deletedAt: IsNull() } : { deletedAt: IsNull() },
    order: { author: 'ASC', title: 'ASC' },
    take: limit,
    skip: offset,
  });

  const books = normalizeBookEntities(await attachBookFormats(formatRepository, bookEntities));
  if (viewerUserId && favoriteRepository) {
    await applyFavoriteStatus(favoriteRepository, books, viewerUserId);
  }

  return {
    data: books,
    limit,
    offset,
    total,
    nextCursor: offset && limit && total > offset + limit ? offset + limit : null,
  };
}

export async function findNewArrivals(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  limit?: number,
  offset?: number,
  ownerScope?: string,
): Promise<PaginationResult<Book[]>> {
  const [bookEntities, total] = await repository.findAndCount({
    where: { deletedAt: IsNull(), ...(ownerScope ? { uploadedByUserId: ownerScope } : {}) },
    order: { createdAt: 'DESC' },
    take: limit,
    skip: offset,
  });
  const booksWithFormats = await attachBookFormats(formatRepository, bookEntities);
  return {
    data: normalizeBookEntities(booksWithFormats),
    limit,
    offset,
    total,
    nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
  };
}

export async function findGenres(repository: Repository<BookEntity>, ownerScope?: string): Promise<string[]> {
  const books = await repository.find({
    select: { genres: true },
    where: { deletedAt: IsNull(), ...(ownerScope ? { uploadedByUserId: ownerScope } : {}) },
  });

  return [
    ...new Set(
      books
        .flatMap((book) => book.genres ?? [])
        .map((genre) => genre.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export async function findFavoriteBooks(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  limit?: number,
  offset?: number,
  userId?: string,
): Promise<PaginationResult<Book[]>> {
  const qb = repository
    .createQueryBuilder('book')
    .where('book.deletedAt IS NULL')
    .innerJoin('user_book_favorite', 'fav', 'fav.book_id = book.id AND fav.user_id = :userId', { userId });
  const [bookEntities, total] = await qb
    .orderBy('book.author', 'ASC')
    .addOrderBy('book.title', 'ASC')
    .take(limit)
    .skip(offset)
    .getManyAndCount();
  const books = normalizeBookEntities(await attachBookFormats(formatRepository, bookEntities)).map((book) => {
    book.isFavorite = true;
    return book;
  });
  return {
    data: books,
    limit,
    offset,
    total,
    nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
  };
}

export async function searchBooksWithFilters(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  filters: BookSearchFilters,
  limit?: number,
  offset?: number,
  userId?: string,
  viewerUserId?: string,
  favoriteRepository?: Repository<UserBookFavoriteEntity>,
): Promise<PaginationResult<Book[]>> {
  const qb = repository.createQueryBuilder('book').where('book.deletedAt IS NULL');
  applySearchFilters(qb, filters);
  if (userId) {
    qb.andWhere('book.uploadedByUserId = :userId', { userId });
  }
  const [bookEntities, total] = await qb
    .orderBy('book.author', 'ASC')
    .addOrderBy('book.title', 'ASC')
    .limit(limit)
    .skip(offset)
    .getManyAndCount();
  const books = normalizeBookEntities(await attachBookFormats(formatRepository, bookEntities));
  if (viewerUserId && favoriteRepository) {
    await applyFavoriteStatus(favoriteRepository, books, viewerUserId);
  }
  return {
    data: books,
    limit,
    offset,
    total,
    nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
  };
}

export async function searchFavoriteBooksWithFilters(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  filters: BookSearchFilters,
  limit?: number,
  offset?: number,
  userId?: string,
): Promise<PaginationResult<Book[]>> {
  const qb = repository
    .createQueryBuilder('book')
    .where('book.isFavorite = true')
    .andWhere('book.deletedAt IS NULL')
    .innerJoin('user_book_favorite', 'fav', 'fav.book_id = book.id AND fav.user_id = :userId', { userId });
  applySearchFilters(qb, filters);
  const [bookEntities, total] = await qb
    .orderBy('book.author', 'ASC')
    .addOrderBy('book.title', 'ASC')
    .limit(limit)
    .skip(offset)
    .getManyAndCount();
  const books = normalizeBookEntities(await attachBookFormats(formatRepository, bookEntities)).map((book) => {
    book.isFavorite = true;
    return book;
  });
  return {
    data: books,
    limit,
    offset,
    total,
    nextCursor: limit && total > (offset || 0) + limit ? (offset || 0) + limit : null,
  };
}

export async function findBookById(
  repository: Repository<BookEntity>,
  bookFormatProcessingService: BookFormatProcessingService,
  id: string,
  viewerUserId?: string,
  favoriteRepository?: Repository<UserBookFavoriteEntity>,
  ownerId?: string,
): Promise<Book> {
  const bookEntity =
    (await repository.findOne({
      where: { id, deletedAt: IsNull() },
      relations: { formats: true },
    })) ?? null;
  if (!bookEntity || (ownerId && bookEntity.uploadedByUserId !== ownerId)) {
    throw new NotFoundException('Book not found');
  }

  const hydratedEntity = await bookFormatProcessingService.hydrateStoredFormatMetadata(bookEntity);
  const book = normalizeBookEntity(hydratedEntity);
  if (viewerUserId && favoriteRepository) {
    await applyFavoriteStatus(favoriteRepository, [book], viewerUserId);
  }
  return book;
}

export async function findBookByFileName(
  repository: Repository<BookEntity>,
  fileName: string,
  includeDeleted = false,
): Promise<Book | null> {
  const qb = repository
    .createQueryBuilder('book')
    .leftJoinAndSelect('book.formats', 'format')
    .where('(book.file_name = :fileName OR format.file_name = :fileName)', { fileName });
  if (!includeDeleted) {
    qb.andWhere('book.deletedAt IS NULL');
  }
  const bookEntity = await qb.getOne();
  return bookEntity ? normalizeBookEntity(bookEntity) : null;
}

export async function findBookByContentHash(
  repository: Repository<BookEntity>,
  hash: string,
  includeDeleted = false,
  ownerId?: string,
): Promise<Book | null> {
  const qb = repository
    .createQueryBuilder('book')
    .leftJoinAndSelect('book.formats', 'format')
    .where('(book.file_content_hash = :hash OR format.file_content_hash = :hash)', { hash });
  if (ownerId) {
    qb.andWhere('book.uploadedByUserId = :ownerId', { ownerId });
  }
  if (!includeDeleted) {
    qb.andWhere('book.deletedAt IS NULL');
  }
  const bookEntity = await qb.getOne();
  return bookEntity ? normalizeBookEntity(bookEntity) : null;
}

export async function findAllActiveBooks(repository: Repository<BookEntity>): Promise<Book[]> {
  const bookEntities = await repository.find({ where: { deletedAt: IsNull() }, relations: { formats: true } });
  return normalizeBookEntities(bookEntities);
}

export async function findUnownedBooks(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  limit?: number,
  offset?: number,
): Promise<PaginationResult<Book[]>> {
  const [bookEntities, total] = await repository.findAndCount({
    where: { uploadedByUserId: IsNull(), deletedAt: IsNull() },
    order: { title: 'ASC' },
    take: limit,
    skip: offset,
  });
  const booksWithFormats = await attachBookFormats(formatRepository, bookEntities);
  return {
    data: normalizeBookEntities(booksWithFormats),
    limit,
    offset,
    total,
    nextCursor: null,
  };
}

export async function findOrphanedBooks(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  knownUserIds: string[],
  limit?: number,
  offset?: number,
): Promise<PaginationResult<Book[]>> {
  const qb = repository
    .createQueryBuilder('book')
    .where('book.deletedAt IS NULL')
    .andWhere('book.uploadedByUserId IS NOT NULL');

  if (knownUserIds.length > 0) {
    qb.andWhere('book.uploadedByUserId NOT IN (:...knownUserIds)', { knownUserIds });
  }

  qb.orderBy('book.title', 'ASC');

  const total = await qb.getCount();
  if (limit !== undefined) qb.take(limit);
  if (offset !== undefined) qb.skip(offset);

  const bookEntities = await qb.getMany();
  const booksWithFormats = await attachBookFormats(formatRepository, bookEntities);
  return {
    data: normalizeBookEntities(booksWithFormats),
    limit,
    offset,
    total,
    nextCursor: null,
  };
}

export async function searchBooksByAuthorAndTitle(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  author: string,
  title: string,
  limit?: number,
  offset?: number,
  userId?: string,
): Promise<PaginationResult<Book[]>> {
  const qb = repository
    .createQueryBuilder('book')
    .where('book.author = :author', { author })
    .andWhere('LOWER(book.title) LIKE LOWER(:title)', { title: `%${title}%` })
    .andWhere('book.deletedAt IS NULL');

  if (userId) {
    qb.andWhere('book.uploadedByUserId = :userId', { userId });
  }

  const [bookEntities, total] = await qb.orderBy('book.title', 'ASC').limit(limit).skip(offset).getManyAndCount();
  const booksWithFormats = await attachBookFormats(formatRepository, bookEntities);

  return {
    data: normalizeBookEntities(booksWithFormats),
    limit,
    offset,
    total,
    nextCursor: limit && total > (offset || 0) + (limit || 0) ? (offset || 0) + (limit || 0) : null,
  };
}

export async function findBooksWithoutMetadata(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  limit: number,
): Promise<Book[]> {
  const bookEntities = await repository.find({
    where: { metadataFetchedAt: IsNull(), deletedAt: IsNull() },
    take: limit,
    order: { title: 'ASC' },
  });
  return normalizeBookEntities(await attachBookFormats(formatRepository, bookEntities));
}

export async function toggleBookFavorite(
  favoriteRepository: Repository<UserBookFavoriteEntity>,
  userId: string,
  bookId: string,
): Promise<{ isFavorite: boolean }> {
  const existing = await favoriteRepository.findOne({ where: { userId, bookId } });
  if (existing) {
    await favoriteRepository.delete({ userId, bookId });
    return { isFavorite: false };
  }

  await favoriteRepository.save({ userId, bookId });
  return { isFavorite: true };
}

export async function updateBookRecord(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  bookFormatProcessingService: BookFormatProcessingService,
  id: string,
  book: Book,
): Promise<Book> {
  const existing = await repository.findOne({
    where: { id },
    relations: { formats: true },
  });

  if (!existing) {
    throw new NotFoundException('Book not found');
  }

  const persistence = toBookEntity(book);
  applyPersistence(existing, persistence);

  await repository.manager.transaction(async (manager) => {
    await saveBookWithFormats(
      manager.getRepository(BookEntity),
      manager.getRepository(BookFormatEntity),
      existing,
      persistence,
    );
  });

  return findPersistedBook(repository, bookFormatProcessingService, id);
}

export async function splitBookFormatRecord(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  bookFormatProcessingService: BookFormatProcessingService,
  bookId: string,
  updatedBook: Book,
  splitBook: Book,
): Promise<Book> {
  const existing = await repository.findOne({
    where: { id: bookId },
    relations: { formats: true },
  });

  if (!existing) {
    throw new NotFoundException('Book not found');
  }

  const updatedPersistence = toBookEntity(updatedBook);
  const splitPersistence = toBookEntity(splitBook);

  applyPersistence(existing, updatedPersistence);

  await repository.manager.transaction(async (manager) => {
    const bookRepository = manager.getRepository(BookEntity);
    const nextFormatRepository = manager.getRepository(BookFormatEntity);
    await saveBookWithFormats(bookRepository, nextFormatRepository, existing, updatedPersistence);
    await bookRepository.save(splitPersistence);
  });

  return findPersistedBook(repository, bookFormatProcessingService, bookId);
}

export async function permanentDeleteBook(
  repository: Repository<BookEntity>,
  id: string,
  storage: IStorageService,
): Promise<Book> {
  const bookEntity = await repository.findOne({ where: { id }, relations: { formats: true } });
  if (!bookEntity) {
    throw new NotFoundException('Book not found');
  }

  const book = normalizeBookEntity(bookEntity);
  const fileNames = new Set(book.formats?.map((format) => format.fileName) ?? [book.fileName]);
  for (const fileName of fileNames) {
    const key = `books/${fileName}`;
    await storage.deleteFile(key);
  }
  const audioFileNames = new Set(
    book.formats?.flatMap((format) => format.audioTracks?.map((track) => track.fileName) ?? []) ?? [],
  );
  for (const fileName of audioFileNames) {
    if (!fileNames.has(fileName)) {
      await storage.deleteFile(`books/${fileName}`);
    }
  }
  await storage.deleteFile(`cover-images/${book.coverImageFileName}`);
  await repository.delete(id);
  return book;
}

export async function softDeleteBookRecord(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  id: string,
): Promise<Book> {
  const bookEntity = await repository.findOne({ where: { id, deletedAt: IsNull() } });
  if (!bookEntity) {
    throw new NotFoundException('Book not found');
  }

  bookEntity.deletedAt = new Date();
  await repository.save(bookEntity);
  const [hydrated] = await attachBookFormats(formatRepository, [bookEntity]);
  return normalizeBookEntity(hydrated);
}

export async function restoreBookRecord(
  repository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  id: string,
): Promise<Book> {
  const bookEntity = await repository.findOne({ where: { id } });
  if (!bookEntity) {
    throw new NotFoundException('Book not found');
  }

  bookEntity.deletedAt = null as unknown as undefined;
  await repository.save(bookEntity);
  const [hydrated] = await attachBookFormats(formatRepository, [bookEntity]);
  return normalizeBookEntity(hydrated);
}

export async function updateStoredBookContentHash(
  repository: Repository<BookEntity>,
  id: string,
  hash: string,
): Promise<void> {
  await repository.update({ id }, { fileContentHash: hash });
}

async function findPersistedBook(
  repository: Repository<BookEntity>,
  bookFormatProcessingService: BookFormatProcessingService,
  id: string,
): Promise<Book> {
  const updated = await repository.findOne({
    where: { id },
    relations: { formats: true },
  });

  if (!updated) {
    throw new NotFoundException('Book not found');
  }

  const hydrated = await bookFormatProcessingService.hydrateStoredFormatMetadata(updated);
  return normalizeBookEntity(hydrated);
}

async function attachBookFormats(
  formatRepository: Repository<BookFormatEntity>,
  bookEntities: BookEntity[],
): Promise<BookEntity[]> {
  if (!bookEntities.length) {
    return bookEntities;
  }

  const missingFormatsFor = bookEntities.filter((bookEntity) => bookEntity.formats === undefined);
  if (!missingFormatsFor.length) {
    return bookEntities;
  }

  const formats = await formatRepository.find({
    where: { bookId: In(missingFormatsFor.map((bookEntity) => bookEntity.id)) },
  });
  const formatsByBookId = new Map<string, BookFormatEntity[]>();

  for (const format of formats) {
    const bookFormats = formatsByBookId.get(format.bookId) ?? [];
    bookFormats.push(format);
    formatsByBookId.set(format.bookId, bookFormats);
  }

  for (const bookEntity of missingFormatsFor) {
    bookEntity.formats = formatsByBookId.get(bookEntity.id) ?? [];
  }

  return bookEntities;
}

async function applyFavoriteStatus(
  favoriteRepository: Repository<UserBookFavoriteEntity>,
  books: Book[],
  userId: string,
): Promise<void> {
  if (!books.length) {
    return;
  }

  const bookIds = books.map((book) => book.id);
  const favorites = await favoriteRepository
    .createQueryBuilder('fav')
    .where('fav.user_id = :userId', { userId })
    .andWhere('fav.book_id IN (:...bookIds)', { bookIds })
    .getMany();
  const favoriteSet = new Set(favorites.map((favorite) => favorite.bookId));
  for (const book of books) {
    book.isFavorite = favoriteSet.has(book.id);
  }
}

function applySearchFilters(qb: SelectQueryBuilder<BookEntity>, filters: BookSearchFilters): void {
  if (filters.query) {
    qb.andWhere('LOWER(book.title) LIKE LOWER(:query)', { query: `%${filters.query}%` });
  }
  if (filters.isbn) {
    qb.andWhere('book.isbn = :isbn', { isbn: filters.isbn });
  }
  if (filters.genre) {
    qb.andWhere('LOWER(book.genres) LIKE LOWER(:genre)', { genre: `%${filters.genre}%` });
  }
  if (filters.series) {
    qb.andWhere('LOWER(book.series) LIKE LOWER(:series)', { series: `%${filters.series}%` });
  }
  if (filters.author) {
    qb.andWhere('LOWER(book.author) LIKE LOWER(:author)', { author: `%${filters.author}%` });
  }
}

function cloneFormatEntity(format: BookFormatEntity, bookId?: string): BookFormatEntity {
  const clonedFormat = Object.assign(new BookFormatEntity(), format);
  Reflect.deleteProperty(clonedFormat, 'book');
  if (bookId) {
    clonedFormat.bookId = bookId;
  } else {
    Reflect.deleteProperty(clonedFormat, 'bookId');
  }
  return clonedFormat;
}

function normalizeBookEntities(bookEntities: BookEntity[]): Book[] {
  return bookEntities.map((bookEntity) => normalizeBookEntity(bookEntity));
}

function toBookEntity(book: Book): BookEntity {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    fileName: book.fileName,
    isFavorite: book.isFavorite,
    publishedYear: book.publishedYear,
    coverImageFileName: book.coverImageFileName,
    summary: book.summary,
    uploadedByUserId: book.uploadedByUserId,
    genres: book.genres,
    series: book.series,
    seriesPosition: book.seriesPosition,
    isbn: book.isbn,
    pageCount: book.pageCount,
    publisher: book.publisher,
    language: book.language,
    averageRating: book.averageRating,
    ratingsCount: book.ratingsCount,
    metadataFetchedAt: book.metadataFetchedAt,
    createdAt: book.createdAt ?? new Date(),
    deletedAt: book.deletedAt ?? (null as unknown as undefined),
    lastSyncedAt: book.lastSyncedAt,
    syncedMetadata: book.syncedMetadata,
    fileMtime: book.fileMtime,
    fileContentHash: book.fileContentHash,
    metadataUpdatedAt: book.metadataUpdatedAt,
    formats: book.formats?.map((format) => cloneFormatEntity(format, book.id)),
  };
}

function applyPersistence(existing: BookEntity, persistence: BookEntity): void {
  existing.title = persistence.title;
  existing.author = persistence.author;
  existing.fileName = persistence.fileName;
  existing.isFavorite = persistence.isFavorite;
  existing.genres = persistence.genres;
  existing.publishedYear = persistence.publishedYear;
  existing.coverImageFileName = persistence.coverImageFileName;
  existing.summary = persistence.summary;
  existing.uploadedByUserId = persistence.uploadedByUserId;
  existing.series = persistence.series;
  existing.seriesPosition = persistence.seriesPosition;
  existing.isbn = persistence.isbn;
  existing.pageCount = persistence.pageCount;
  existing.publisher = persistence.publisher;
  existing.language = persistence.language;
  existing.averageRating = persistence.averageRating;
  existing.ratingsCount = persistence.ratingsCount;
  existing.metadataFetchedAt = persistence.metadataFetchedAt;
  existing.lastSyncedAt = persistence.lastSyncedAt;
  existing.syncedMetadata = persistence.syncedMetadata;
  existing.fileMtime = persistence.fileMtime;
  existing.fileContentHash = persistence.fileContentHash;
  existing.metadataUpdatedAt = persistence.metadataUpdatedAt;
  existing.deletedAt = persistence.deletedAt;
}

async function saveBookWithFormats(
  bookRepository: Repository<BookEntity>,
  formatRepository: Repository<BookFormatEntity>,
  existing: BookEntity,
  persistence: BookEntity,
): Promise<void> {
  await bookRepository.save(existing);

  if (persistence.formats === undefined) {
    return;
  }

  const nextFormats = persistence.formats.map((format) => {
    format.bookId = existing.id;
    return format;
  });
  const nextFormatIds = new Set(nextFormats.map((format) => format.id));
  const removedFormatIds = (existing.formats ?? [])
    .filter((format) => !nextFormatIds.has(format.id))
    .map((format) => format.id);

  if (removedFormatIds.length > 0) {
    await formatRepository.delete({ id: In(removedFormatIds) });
  }

  if (nextFormats.length > 0) {
    await formatRepository.save(nextFormats);
  }
}
