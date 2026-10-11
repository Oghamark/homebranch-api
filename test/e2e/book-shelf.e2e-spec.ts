import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BookShelfController } from 'src/modules/book-shelf/book-shelf.controller';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { mockBookEntity } from 'test/mocks/bookMocks';
import { mockBookShelf } from 'test/mocks/bookShelfMocks';

describe('BookShelfController (e2e)', () => {
  let app: INestApplication<App>;

  interface BookshelfListResponse {
    data: Array<{ id: string; title: string }>;
  }

  interface BookShelfResponse {
    id: string;
    title: string;
    books: Array<{ id: string }>;
  }

  const mockBookShelfService = {
    getBookShelves: jest.fn(),
    getBookShelfById: jest.fn(),
    getBookShelfBooks: jest.fn(),
    getBookShelvesByBook: jest.fn(),
    createBookShelf: jest.fn(),
    deleteBookShelf: jest.fn(),
    updateBookShelf: jest.fn(),
    addBookToBookShelf: jest.fn(),
    removeBookFromBookShelf: jest.fn(),
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [BookShelfController],
      providers: [{ provide: BookShelfService, useValue: mockBookShelfService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          context.switchToHttp().getRequest().user = { id: 'user-1' };
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    jest.clearAllMocks();
    await app.close();
  });

  it('returns paginated bookshelves', async () => {
    mockBookShelfService.getBookShelves.mockResolvedValueOnce({
      data: [mockBookShelf],
      limit: 10,
      offset: 0,
      total: 1,
      nextCursor: null,
    });

    const response = await request(app.getHttpServer()).get('/book-shelves').expect(200);
    const body = response.body as BookshelfListResponse;

    expect(body.data).toHaveLength(1);
    expect(mockBookShelfService.getBookShelves).toHaveBeenCalledWith(undefined, undefined, 'user-1');
  });

  it('returns a bookshelf by id', async () => {
    mockBookShelfService.getBookShelfById.mockResolvedValueOnce(mockBookShelf);

    const response = await request(app.getHttpServer()).get('/book-shelves/bookshelf-123').expect(200);
    const body = response.body as BookShelfResponse;

    expect(body.title).toBe('Test Book Shelf');
  });

  it('returns filtered and paginated bookshelf books', async () => {
    mockBookShelfService.getBookShelfBooks.mockResolvedValueOnce({
      data: [mockBookEntity],
      total: 1,
      limit: 10,
      offset: 5,
      nextCursor: null,
    });

    const response = await request(app.getHttpServer())
      .get('/book-shelves/bookshelf-123/books?limit=10&offset=5&query=test')
      .expect(200);
    const body = response.body as BookshelfListResponse;

    expect(body.data).toHaveLength(1);
    expect(mockBookShelfService.getBookShelfBooks).toHaveBeenCalledWith('bookshelf-123', undefined, '10', '5', 'test');
  });

  it('creates a bookshelf', async () => {
    mockBookShelfService.createBookShelf.mockResolvedValueOnce(mockBookShelf);

    const response = await request(app.getHttpServer()).post('/book-shelves').send({ title: 'Fiction' }).expect(201);
    const body = response.body as BookShelfResponse;

    expect(body.title).toBe('Test Book Shelf');
    expect(mockBookShelfService.createBookShelf).toHaveBeenCalledWith('Fiction', 'user-1');
  });

  it('updates a bookshelf', async () => {
    mockBookShelfService.updateBookShelf.mockResolvedValueOnce({ ...mockBookShelf, title: 'Updated Title' });

    const response = await request(app.getHttpServer())
      .put('/book-shelves/bookshelf-123')
      .send({ title: 'Updated Title' })
      .expect(200);
    const body = response.body as BookShelfResponse;

    expect(body.title).toBe('Updated Title');
    expect(mockBookShelfService.updateBookShelf).toHaveBeenCalledWith('bookshelf-123', 'Updated Title');
  });

  it('deletes a bookshelf', async () => {
    mockBookShelfService.deleteBookShelf.mockResolvedValueOnce(mockBookShelf);

    const response = await request(app.getHttpServer()).delete('/book-shelves/bookshelf-123').expect(200);
    const body = response.body as BookShelfResponse;

    expect(body.id).toBe('bookshelf-123');
  });

  it('adds a book to a bookshelf', async () => {
    mockBookShelfService.addBookToBookShelf.mockResolvedValueOnce({ ...mockBookShelf, books: [mockBookEntity] });

    const response = await request(app.getHttpServer())
      .put('/book-shelves/bookshelf-123/add-book')
      .send({ bookId: 'book-456' })
      .expect(200);
    const body = response.body as BookShelfResponse;

    expect(body.books).toHaveLength(1);
    expect(mockBookShelfService.addBookToBookShelf).toHaveBeenCalledWith('bookshelf-123', 'book-456');
  });

  it('removes a book from a bookshelf', async () => {
    mockBookShelfService.removeBookFromBookShelf.mockResolvedValueOnce(mockBookShelf);

    const response = await request(app.getHttpServer())
      .put('/book-shelves/bookshelf-123/remove-book')
      .send({ bookId: 'book-456' })
      .expect(200);
    const body = response.body as BookShelfResponse;

    expect(body.id).toBe('bookshelf-123');
    expect(mockBookShelfService.removeBookFromBookShelf).toHaveBeenCalledWith('bookshelf-123', 'book-456');
  });
});
