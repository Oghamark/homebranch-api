import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { BookEntity } from 'src/modules/book/book.entity';
import { mockBookEntity } from 'test/mocks/bookMocks';
import { mockAddBookToBookShelfRequest, mockBookShelf } from 'test/mocks/bookShelfMocks';

interface BookShelfRelationQueryBuilderMock {
  relation: jest.Mock<BookShelfRelationQueryBuilderMock, [typeof BookShelfEntity, string]>;
  of: jest.Mock<BookShelfRelationQueryBuilderMock, [string]>;
  add: jest.Mock<Promise<void>, [string]>;
  remove: jest.Mock<Promise<void>, [string]>;
}

interface BookQueryBuilderMock {
  innerJoin: jest.Mock<BookQueryBuilderMock, [string, string, string, { shelfId: string }]>;
  where: jest.Mock<BookQueryBuilderMock, [string]>;
  andWhere: jest.Mock<BookQueryBuilderMock, [string, Record<string, string>]>;
  orderBy: jest.Mock<BookQueryBuilderMock, [string, 'ASC' | 'DESC']>;
  addOrderBy: jest.Mock<BookQueryBuilderMock, [string, 'ASC' | 'DESC']>;
  take: jest.Mock<BookQueryBuilderMock, [number | undefined]>;
  skip: jest.Mock<BookQueryBuilderMock, [number | undefined]>;
  getManyAndCount: jest.Mock<Promise<[BookEntity[], number]>, []>;
}

interface BookShelfRepositoryMock {
  findAndCount: jest.Mock<Promise<[BookShelfEntity[], number]>, [unknown]>;
  findOne: jest.Mock<Promise<BookShelfEntity | null>, [unknown]>;
  exist: jest.Mock<Promise<boolean>, [unknown]>;
  create: jest.Mock<BookShelfEntity, [Partial<BookShelfEntity>]>;
  save: jest.Mock<Promise<BookShelfEntity>, [BookShelfEntity]>;
  delete: jest.Mock<Promise<void>, [string]>;
  createQueryBuilder: jest.Mock<BookShelfRelationQueryBuilderMock, []>;
}

interface BookRepositoryMock {
  createQueryBuilder: jest.Mock<BookQueryBuilderMock, [string]>;
  findOne: jest.Mock<Promise<BookEntity | null>, [unknown]>;
}

describe('BookShelfService', () => {
  let service: BookShelfService;
  let bookShelfRepository: BookShelfRepositoryMock;
  let bookRepository: BookRepositoryMock;

  beforeEach(async () => {
    bookShelfRepository = {
      findAndCount: jest.fn(),
      findOne: jest.fn(),
      exist: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    bookRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookShelfService,
        { provide: getRepositoryToken(BookShelfEntity), useValue: bookShelfRepository },
        { provide: getRepositoryToken(BookEntity), useValue: bookRepository },
      ],
    }).compile();

    service = module.get<BookShelfService>(BookShelfService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('returns paginated bookshelves', async () => {
    bookShelfRepository.findAndCount.mockResolvedValueOnce([[mockBookShelf], 1]);

    const result = await service.getBookShelves(10, 0, 'user-1');

    expect(bookShelfRepository.findAndCount).toHaveBeenCalledWith({
      where: { createdByUserId: 'user-1' },
      relations: ['books'],
      take: 10,
      skip: 0,
    });
    expect(result).toEqual({ data: [mockBookShelf], limit: 10, offset: 0, total: 1, nextCursor: null });
  });

  test('returns bookshelf by id', async () => {
    bookShelfRepository.findOne.mockResolvedValueOnce(mockBookShelf);

    await expect(service.getBookShelfById(mockBookShelf.id)).resolves.toEqual(mockBookShelf);
  });

  test('throws when bookshelf is missing', async () => {
    bookShelfRepository.findOne.mockResolvedValueOnce(null);

    await expect(service.getBookShelfById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  test('returns filtered and paginated bookshelf books', async () => {
    bookShelfRepository.exist.mockResolvedValueOnce(true);
    const queryBuilder: BookQueryBuilderMock = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValueOnce([[mockBookEntity], 20]),
    };
    bookRepository.createQueryBuilder.mockReturnValueOnce(queryBuilder);

    const result = await service.getBookShelfBooks(mockBookShelf.id, 'user-1', 10, 5, 'test');

    expect(queryBuilder.innerJoin).toHaveBeenCalledWith('book.bookShelves', 'shelf', 'shelf.id = :shelfId', {
      shelfId: mockBookShelf.id,
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('book.uploadedByUserId = :ownerScope', { ownerScope: 'user-1' });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(LOWER(book.title) LIKE LOWER(:query) OR LOWER(book.author) LIKE LOWER(:query))',
      { query: '%test%' },
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
    expect(queryBuilder.skip).toHaveBeenCalledWith(5);
    expect(result).toEqual({ data: [mockBookEntity], limit: 10, offset: 5, total: 20, nextCursor: 15 });
  });

  test('creates a bookshelf', async () => {
    bookShelfRepository.create.mockReturnValueOnce(mockBookShelf);
    bookShelfRepository.save.mockResolvedValueOnce(mockBookShelf);

    const result = await service.createBookShelf('Test Book Shelf', 'user-1');

    expect(bookShelfRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test Book Shelf', createdByUserId: 'user-1', books: [] }),
    );
    expect(result).toEqual(mockBookShelf);
  });

  test('updates a bookshelf title', async () => {
    bookShelfRepository.findOne.mockResolvedValueOnce({ ...mockBookShelf }).mockResolvedValueOnce({
      ...mockBookShelf,
      title: 'Updated Shelf',
    });
    bookShelfRepository.save.mockResolvedValueOnce({ ...mockBookShelf, title: 'Updated Shelf' });

    const result = await service.updateBookShelf(mockBookShelf.id, 'Updated Shelf');

    expect(bookShelfRepository.save).toHaveBeenCalledWith(expect.objectContaining({ title: 'Updated Shelf' }));
    expect(result.title).toBe('Updated Shelf');
  });

  test('deletes a bookshelf after loading it', async () => {
    bookShelfRepository.findOne.mockResolvedValueOnce(mockBookShelf);

    const result = await service.deleteBookShelf(mockBookShelf.id);

    expect(bookShelfRepository.delete).toHaveBeenCalledWith(mockBookShelf.id);
    expect(result).toEqual(mockBookShelf);
  });

  test('adds a book only when not already present', async () => {
    const relationBuilder: BookShelfRelationQueryBuilderMock = {
      relation: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
      add: jest.fn().mockResolvedValueOnce(undefined),
      remove: jest.fn(),
    };
    bookShelfRepository.findOne
      .mockResolvedValueOnce({ ...mockBookShelf, books: [] })
      .mockResolvedValueOnce({ ...mockBookShelf, books: [mockBookEntity] });
    bookShelfRepository.createQueryBuilder.mockReturnValueOnce(relationBuilder);
    bookRepository.findOne.mockResolvedValueOnce(mockBookEntity);

    const result = await service.addBookToBookShelf(
      mockAddBookToBookShelfRequest.bookShelfId,
      mockAddBookToBookShelfRequest.bookId,
    );

    expect(bookRepository.findOne).toHaveBeenCalledWith({
      where: { id: mockBookEntity.id, deletedAt: expect.anything() },
    });
    expect(relationBuilder.add).toHaveBeenCalledWith(mockBookEntity.id);
    expect(result.books).toEqual([mockBookEntity]);
  });

  test('removes a book only when present', async () => {
    const relationBuilder: BookShelfRelationQueryBuilderMock = {
      relation: jest.fn().mockReturnThis(),
      of: jest.fn().mockReturnThis(),
      add: jest.fn(),
      remove: jest.fn().mockResolvedValueOnce(undefined),
    };
    bookShelfRepository.findOne
      .mockResolvedValueOnce({ ...mockBookShelf, books: [mockBookEntity] })
      .mockResolvedValueOnce({ ...mockBookShelf, books: [] });
    bookShelfRepository.createQueryBuilder.mockReturnValueOnce(relationBuilder);

    const result = await service.removeBookFromBookShelf(mockBookShelf.id, mockBookEntity.id);

    expect(relationBuilder.remove).toHaveBeenCalledWith(mockBookEntity.id);
    expect(result.books).toEqual([]);
  });
});
