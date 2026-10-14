import { Brackets, Repository } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { findGenres, findMatchingBooksForWork } from 'src/modules/book/persistence/book.persistence';

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
