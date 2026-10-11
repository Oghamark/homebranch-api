import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaginationResult } from 'src/common/core/pagination_result';
import { Book } from 'src/modules/book/book.model';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { IStorageService } from 'src/modules/storage/storage.interface';
import { mockBook, mockBookFavorite } from 'test/mocks/bookMocks';

describe('BookService', () => {
  let service: BookService;
  let bookPersistenceService: jest.Mocked<BookPersistenceService>;
  let metadataGateway: { enrichBook: jest.Mock };
  let summaryGateway: { fetchSummary: jest.Mock };
  let openLibraryGateway: { searchBookCovers: jest.Mock; fetchBookCover: jest.Mock };
  let storage: jest.Mocked<Pick<IStorageService, 'uploadFile'>>;

  beforeEach(() => {
    bookPersistenceService = {
      searchBooksWithFilters: jest.fn(),
      findBooks: jest.fn(),
      findFavoriteBooks: jest.fn(),
      searchFavoriteBooksWithFilters: jest.fn(),
      findBookById: jest.fn(),
      toggleBookFavorite: jest.fn(),
      permanentDeleteBook: jest.fn(),
      updateBookRecord: jest.fn(),
      findNewArrivals: jest.fn(),
    } as unknown as jest.Mocked<BookPersistenceService>;
    metadataGateway = { enrichBook: jest.fn() };
    summaryGateway = { fetchSummary: jest.fn() };
    openLibraryGateway = { searchBookCovers: jest.fn(), fetchBookCover: jest.fn() };
    storage = { uploadFile: jest.fn() };

    service = new BookService(
      bookPersistenceService,
      metadataGateway as never,
      summaryGateway as never,
      openLibraryGateway as never,
      storage as never,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('lists books through filtered search when filters are present', async () => {
    const paginationResult: PaginationResult<Book[]> = {
      data: [mockBook],
      total: 1,
      limit: 10,
      offset: 5,
      nextCursor: null,
    };
    bookPersistenceService.searchBooksWithFilters.mockResolvedValueOnce(paginationResult);

    await expect(
      service.getBooks({ query: 'Test', limit: 10, offset: 5, userId: 'user-1', viewerUserId: 'viewer-1' }),
    ).resolves.toEqual(paginationResult);
  });

  test('lists favorite books without filters through favorite query helper', async () => {
    const paginationResult: PaginationResult<Book[]> = {
      data: [{ ...mockBook, isFavorite: true }],
      total: 1,
      limit: 20,
      offset: 0,
      nextCursor: null,
    };
    bookPersistenceService.findFavoriteBooks.mockResolvedValueOnce(paginationResult);

    await expect(service.getFavoriteBooks({ userId: 'user-1', limit: 20, offset: 0 })).resolves.toEqual(
      paginationResult,
    );
  });

  test('lists genres through the persistence service', async () => {
    bookPersistenceService.findGenres = jest.fn().mockResolvedValueOnce(['Fantasy']);

    await expect(service.getGenres('user-1')).resolves.toEqual(['Fantasy']);
    expect(bookPersistenceService.findGenres).toHaveBeenCalledWith('user-1');
  });

  test('gets a single book by id', async () => {
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);

    await expect(service.getBookById(mockBook.id, 'viewer-1')).resolves.toEqual(mockBook);
  });

  test('toggles a favorite book', async () => {
    bookPersistenceService.toggleBookFavorite.mockResolvedValueOnce({ isFavorite: true });

    await expect(service.toggleFavorite('user-1', mockBook.id)).resolves.toEqual({ isFavorite: true });
  });

  test('deletes a book for its owner', async () => {
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    bookPersistenceService.permanentDeleteBook.mockResolvedValueOnce(mockBook);

    await expect(service.deleteBook(mockBook.id, mockBook.uploadedByUserId!, false)).resolves.toEqual(mockBook);
  });

  test('blocks deletion for a different non-admin user', async () => {
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);

    await expect(service.deleteBook(mockBook.id, 'other-user', false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(bookPersistenceService.permanentDeleteBook).not.toHaveBeenCalled();
  });

  test('assigns a book owner for an admin', async () => {
    const updatedBook = { ...mockBook, uploadedByUserId: 'user-999' };
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    bookPersistenceService.updateBookRecord.mockResolvedValueOnce(updatedBook);

    await expect(service.assignBookOwner(mockBook.id, 'user-999', true)).resolves.toEqual(updatedBook);
  });

  test('enriches and persists metadata', async () => {
    const enrichedBook = { ...mockBook, genres: ['Fiction'] };
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    metadataGateway.enrichBook.mockResolvedValueOnce(enrichedBook);
    bookPersistenceService.updateBookRecord.mockResolvedValueOnce(enrichedBook);

    await expect(service.fetchBookMetadata(mockBook.id)).resolves.toEqual(enrichedBook);
    expect(metadataGateway.enrichBook).toHaveBeenCalledWith(mockBook);
  });

  test('searches Open Library for covers using the book metadata', async () => {
    const covers = [{ coverId: 123, title: 'Test Book', authors: ['Test Author'], thumbnailUrl: 'https://covers' }];
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    openLibraryGateway.searchBookCovers.mockResolvedValueOnce(covers);

    await expect(service.searchBookCovers(mockBook.id, 'alternate search')).resolves.toEqual(covers);
    expect(openLibraryGateway.searchBookCovers).toHaveBeenCalledWith(
      mockBook.title,
      mockBook.author,
      'alternate search',
    );
  });

  test('stores a selected cover and updates the book record', async () => {
    const coverBuffer = Buffer.from('image');
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    openLibraryGateway.fetchBookCover.mockResolvedValueOnce({ buffer: coverBuffer, mimeType: 'image/png' });
    storage.uploadFile.mockResolvedValueOnce({ key: 'cover-images/test.png', url: '' });
    bookPersistenceService.updateBookRecord.mockImplementationOnce((_id, updatedBook) => Promise.resolve(updatedBook));

    const updatedBook = await service.selectBookCover(mockBook.id, 123);

    expect(storage.uploadFile).toHaveBeenCalledTimes(1);
    const [, uploadOptions] = storage.uploadFile.mock.calls[0];
    expect(uploadOptions.key).toMatch(/^cover-images\/.+\.png$/);
    expect(uploadOptions.mimeType).toBe('image/png');
    expect(updatedBook.coverImageFileName).toMatch(/\.png$/);
    expect(bookPersistenceService.updateBookRecord).toHaveBeenCalledWith(mockBook.id, updatedBook);
  });

  test('returns the existing book when no summary is found', async () => {
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBookFavorite);
    summaryGateway.fetchSummary.mockResolvedValueOnce(null);

    await expect(service.fetchBookSummary(mockBookFavorite.id)).resolves.toEqual(mockBookFavorite);
    expect(bookPersistenceService.updateBookRecord).not.toHaveBeenCalled();
  });

  test('returns download information for the preferred book format', async () => {
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);

    await expect(service.getDownload(mockBook.id)).resolves.toEqual({
      book: mockBook,
      format: BookFormatType.EPUB,
      fileName: mockBook.fileName,
    });
  });

  test('surfaces not found errors from the lookup helper', async () => {
    bookPersistenceService.findBookById.mockRejectedValueOnce(new NotFoundException('Book not found'));

    await expect(service.getBookById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('surfaces unexpected list errors', async () => {
    bookPersistenceService.findBooks.mockRejectedValueOnce(new Error('Database error'));

    await expect(service.getBooks({})).rejects.toThrow('Database error');
  });
});
