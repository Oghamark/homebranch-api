import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { BookController } from 'src/modules/book/catalog/book.controller';
import { BookCreationService } from 'src/modules/book/catalog/book-creation.service';
import { BookMutationService } from 'src/modules/book/catalog/book-mutation.service';
import { BookService } from 'src/modules/book/catalog/book.service';
import { mockBook } from 'test/mocks/bookMocks';

describe('BookController (e2e)', () => {
  let app: INestApplication<App>;
  let uploadsDir: string;

  const mockBookService = {
    getBooks: jest.fn(),
    getCurrentUserBooks: jest.fn(),
    getGenres: jest.fn(),
    getFavoriteBooks: jest.fn(),
    getBookById: jest.fn(),
    toggleFavorite: jest.fn(),
    deleteBook: jest.fn(),
    assignBookOwner: jest.fn(),
    bulkAssignBookOwner: jest.fn(),
    fetchBookMetadata: jest.fn(),
    fetchBookSummary: jest.fn(),
  };
  const mockBookMutationService = {
    updateBook: jest.fn(),
    linkBooks: jest.fn(),
    unlinkBookFormat: jest.fn(),
  };
  const mockBookCreationService = {
    createBook: jest.fn(),
  };
  const authGuard = {
    canActivate: (context: { switchToHttp: () => { getRequest: () => { user?: unknown } } }) => {
      context.switchToHttp().getRequest().user = { id: 'user-123', roles: ['ADMIN'] };
      return true;
    },
  };

  beforeEach(async () => {
    uploadsDir = mkdtempSync(join(tmpdir(), 'homebranch-book-e2e-'));
    mkdirSync(join(uploadsDir, 'incoming'));
    mkdirSync(join(uploadsDir, 'cover-images'));
    process.env.UPLOADS_DIRECTORY = uploadsDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BookController],
      providers: [
        { provide: BookService, useValue: mockBookService },
        { provide: BookCreationService, useValue: mockBookCreationService },
        { provide: BookMutationService, useValue: mockBookMutationService },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(authGuard)
      .overrideGuard(RolesGuard)
      .useValue(authGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    delete process.env.UPLOADS_DIRECTORY;
    await app.close();
    rmSync(uploadsDir, { recursive: true, force: true });
  });

  test('lists books with a plain response payload', async () => {
    mockBookService.getBooks.mockResolvedValueOnce({
      data: [mockBook],
      total: 1,
      limit: 20,
      offset: 0,
      nextCursor: null,
    });

    const response = await request(app.getHttpServer()).get('/books').expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.total).toBe(1);
    expect(mockBookService.getBooks).toHaveBeenCalledWith(expect.objectContaining({ viewerUserId: 'user-123' }));
  });

  test('lists the authenticated users library before the book id route and ignores a forged user id', async () => {
    mockBookService.getCurrentUserBooks.mockResolvedValueOnce({
      data: [mockBook],
      total: 1,
      limit: 10,
      offset: 5,
      nextCursor: null,
    });

    const response = await request(app.getHttpServer())
      .get('/books/mine?userId=someone-else&query=Test&limit=10&offset=5')
      .expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.data).toEqual([expect.objectContaining({ id: mockBook.id })]);
    expect(mockBookService.getCurrentUserBooks).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'someone-else', query: 'Test', limit: '10', offset: '5' }),
      'user-123',
    );
    expect(mockBookService.getBookById).not.toHaveBeenCalled();
  });

  test('gets favorite books with a plain response payload', async () => {
    mockBookService.getFavoriteBooks.mockResolvedValueOnce({
      data: [{ ...mockBook, isFavorite: true }],
      total: 1,
      limit: 20,
      offset: 0,
      nextCursor: null,
    });

    const response = await request(app.getHttpServer()).get('/books/favorite').expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.total).toBe(1);
    expect(mockBookService.getFavoriteBooks).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-123' }));
  });

  test('lists genres before the book id route', async () => {
    mockBookService.getGenres.mockResolvedValueOnce(['Fantasy', 'Science Fiction']);

    const response = await request(app.getHttpServer()).get('/books/genres').expect(200);

    expect(response.body).toEqual(['Fantasy', 'Science Fiction']);
    expect(mockBookService.getGenres).toHaveBeenCalledWith(undefined);
  });

  test('toggles a favorite book with a plain response payload', async () => {
    mockBookService.toggleFavorite.mockResolvedValueOnce({ isFavorite: true });

    const response = await request(app.getHttpServer()).put('/books/book-1/favorite').expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.isFavorite).toBe(true);
    expect(mockBookService.toggleFavorite).toHaveBeenCalledWith('user-123', 'book-1');
  });

  test('gets a single book with a plain response payload', async () => {
    mockBookService.getBookById.mockResolvedValueOnce(mockBook);

    const response = await request(app.getHttpServer()).get(`/books/${mockBook.id}`).expect(200);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.id).toBe(mockBook.id);
    expect(mockBookService.getBookById).toHaveBeenCalledWith(mockBook.id, 'user-123');
  });

  test('creates a book with a plain response payload', async () => {
    mockBookCreationService.createBook.mockResolvedValueOnce(mockBook);

    const response = await request(app.getHttpServer())
      .post('/books')
      .field('title', 'Test Book')
      .field('author', 'Test Author')
      .attach('file', Buffer.from('epub'), 'test-book.epub')
      .expect(201);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    expect(response.body.id).toBe(mockBook.id);
    expect(mockBookCreationService.createBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Test Book',
        author: 'Test Author',
        uploadedByUserId: 'user-123',
        originalFileName: 'test-book.epub',
      }),
    );
  });

  test('returns the skipped duplicate payload directly when creation is skipped', async () => {
    mockBookCreationService.createBook.mockResolvedValueOnce({ skipped: true, existingBook: mockBook });

    const response = await request(app.getHttpServer())
      .post('/books')
      .field('title', 'Test Book')
      .field('author', 'Test Author')
      .attach('file', Buffer.from('epub'), 'test-book.epub')
      .expect(201);

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    expect(response.body).toEqual({ skipped: true, existingBook: expect.objectContaining({ id: mockBook.id }) });
  });

  test('bulk assigns an owner with a plain response payload', async () => {
    mockBookService.bulkAssignBookOwner.mockResolvedValueOnce({ assigned: 2, failed: 1, total: 3 });

    const response = await request(app.getHttpServer())
      .patch('/books/assign-owner')
      .send({ bookIds: ['a', 'b', 'c'], userId: 'owner-1' })
      .expect(200);

    expect(response.body).toEqual({ assigned: 2, failed: 1, total: 3 });
    expect(mockBookService.bulkAssignBookOwner).toHaveBeenCalledWith(['a', 'b', 'c'], 'owner-1', true);
  });

  test('fetches book metadata with a plain response payload', async () => {
    mockBookService.fetchBookMetadata.mockResolvedValueOnce(mockBook);

    const response = await request(app.getHttpServer()).post(`/books/${mockBook.id}/fetch-metadata`).expect(201);

    expect(response.body.id).toBe(mockBook.id);
    expect(mockBookService.fetchBookMetadata).toHaveBeenCalledWith(mockBook.id);
  });
});
