import { Brackets, Repository } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import {
  findBooks,
  findGenres,
  findMatchingBooksForWork,
  searchBooksWithFilters,
} from 'src/modules/book/persistence/book.persistence';

describe('searchBooksWithFilters', () => {
  test('applies advanced filters and whitelisted stable sorting before pagination', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;
    const formatRepository = {} as never;

    await searchBooksWithFilters(
      repository,
      formatRepository,
      {
        genreFilter: 'Fantasy',
        seriesFilter: 'Earthsea',
        language: 'English',
        publisher: 'Ace',
        yearFrom: 1968,
        yearTo: 1990,
        sortBy: 'publishedYear',
        sortDirection: 'DESC',
      },
      20,
      40,
      'user-1',
    );

    expect(queryBuilder.andWhere).toHaveBeenCalledWith('LOWER(book.genres) LIKE LOWER(:genreFilter)', {
      genreFilter: '%Fantasy%',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('LOWER(book.series) LIKE LOWER(:seriesFilter)', {
      seriesFilter: '%Earthsea%',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('LOWER(book.language) LIKE LOWER(:language)', {
      language: '%English%',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('LOWER(book.publisher) LIKE LOWER(:publisher)', {
      publisher: '%Ace%',
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('book.publishedYear >= :yearFrom', { yearFrom: 1968 });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith('book.publishedYear <= :yearTo', { yearTo: 1990 });
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('book.publishedYear', 'DESC', 'NULLS LAST');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('book.title', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('book.author', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('book.id', 'ASC');
    expect(queryBuilder.limit).toHaveBeenCalledWith(20);
    expect(queryBuilder.skip).toHaveBeenCalledWith(40);
  });
});

describe('findBooks', () => {
  test('defaults to stable title-ascending order', async () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findBooks(repository, {} as never, 20, 0);

    expect(queryBuilder.orderBy).toHaveBeenCalledWith('book.title', 'ASC', undefined);
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('book.author', 'ASC');
    expect(queryBuilder.addOrderBy).toHaveBeenCalledWith('book.id', 'ASC');
  });
});

describe('findGenres', () => {
  test('returns distinct, trimmed, sorted genres in the owner scope', async () => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          { genres: [' Fantasy ', '', 'Science Fiction'] },
          { genres: ['Fantasy', '  ', 'Biography'] },
        ]),
    } as unknown as Repository<BookEntity>;

    await expect(findGenres(repository, 'user-1')).resolves.toEqual(['Biography', 'Fantasy', 'Science Fiction']);
    expect(repository.find).toHaveBeenCalledWith({
      select: { genres: true },
      where: {
        deletedAt: expect.anything(),
        uploadedByUserId: 'user-1',
      },
    });
  });
});

describe('findMatchingBooksForWork', () => {
  test('uses accent-insensitive SQL normalization for normalized title candidates', async () => {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findMatchingBooksForWork(repository, { title: 'Café' });

    const whereCalls = queryBuilder.andWhere.mock.calls as unknown as Array<[unknown]>;
    const bracket = whereCalls
      .map(([condition]) => condition)
      .find((condition): condition is Brackets => condition instanceof Brackets);
    expect(bracket).toBeDefined();
    const conditions: string[] = [];
    bracket!.whereFactory({
      where: (condition: string) => {
        conditions.push(condition);
      },
      orWhere: (condition: string) => {
        conditions.push(condition);
      },
    } as never);
    expect(conditions[0]).toContain('normalize(lower(book.title), NFKD)');
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(Brackets));
  });

  test('prefilters metadata candidates by normalized author, series, and volume', async () => {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findMatchingBooksForWork(repository, {
      title: 'Café',
      author: 'José García',
      series: 'The Saga',
      seriesPosition: 2,
    } as never);

    const whereCalls = queryBuilder.andWhere.mock.calls as unknown as Array<[unknown]>;
    const bracket = whereCalls
      .map(([condition]) => condition)
      .find((condition): condition is Brackets => condition instanceof Brackets);
    expect(bracket).toBeDefined();
    const conditions: string[] = [];
    bracket!.whereFactory({
      where: (condition: string) => {
        conditions.push(condition);
      },
      orWhere: (condition: string) => {
        conditions.push(condition);
      },
    } as never);
    const metadataConditions = conditions.join(' ');
    expect(metadataConditions).toContain('normalize(lower(book.author), NFKD)');
    expect(metadataConditions).toContain('normalize(lower(book.series), NFKD)');
    expect(metadataConditions).toContain('book.seriesPosition');
  });

  test('uses the parent book author when prefiltering format-title candidates', async () => {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findMatchingBooksForWork(repository, { title: 'The Edition Title', author: 'A. Writer' });

    const whereCalls = queryBuilder.andWhere.mock.calls as unknown as Array<[unknown]>;
    const bracket = whereCalls
      .map(([condition]) => condition)
      .find((condition): condition is Brackets => condition instanceof Brackets);
    expect(bracket).toBeDefined();
    const conditions: string[] = [];
    bracket!.whereFactory({
      where: (condition: string) => conditions.push(condition),
      orWhere: (condition: string) => conditions.push(condition),
    } as never);

    expect(conditions.join(' ')).toContain('COALESCE(format.author, book.author)');
  });

  test('selects only matching metadata instead of hashes and file metadata', async () => {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findMatchingBooksForWork(repository, { title: 'Café' });

    const selectCalls = queryBuilder.select.mock.calls as unknown as Array<[string[]]>;
    const selected = selectCalls[0]?.[0] ?? [];
    expect(selected).toEqual(
      expect.arrayContaining(['book.id', 'book.title', 'book.author', 'format.id', 'format.title']),
    );
    expect(selected).not.toEqual(
      expect.arrayContaining(['book.fileContentHash', 'format.fileContentHash', 'format.fileName']),
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(100);
  });

  test('prioritizes stable-identifier matches before bounded metadata candidates', async () => {
    const queryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    } as unknown as Repository<BookEntity>;

    await findMatchingBooksForWork(repository, { title: 'The Work', isbn: '9780000000000' });

    const addSelectCalls = queryBuilder.addSelect.mock.calls as unknown as Array<[string, string]>;
    const rankSql = addSelectCalls[0]?.[0];
    expect(rankSql).toContain('CASE WHEN');
    expect(rankSql).toContain('book.isbn');
    expect(rankSql).not.toContain('book.externalWorkId');
    expect(rankSql).not.toContain('format.editionId');
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('identifier_match_rank', 'ASC');
    expect(queryBuilder.take).toHaveBeenCalledWith(100);
  });
});
