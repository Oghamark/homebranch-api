import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import {
  BookClubReadingCopySource,
  BookClubRole,
  BookClubStatus,
  BookClubVisibility,
} from 'src/modules/book-clubs/book-club.types';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

describe('Book club reading-copy associations', () => {
  const clubId = '123e4567-e89b-42d3-a456-426614174001';
  const workId = '123e4567-e89b-42d3-a456-426614174002';
  const bookId = '123e4567-e89b-42d3-a456-426614174003';
  const userId = '123e4567-e89b-42d3-a456-426614174004';
  const originalCloudMode = process.env.CLOUD_MODE;
  const club = { id: clubId, visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ACTIVE };
  const membership = { id: 'member-association-id', clubId, userId, role: BookClubRole.MEMBER };
  const work = { id: workId, clubId, title: 'Selected logical work', author: 'Author' };

  const clubRepository = { findOne: jest.fn() };
  const memberRepository = { findOne: jest.fn() };
  const workRepository = { findOne: jest.fn() };
  const readingCopyRepository = {
    create: jest.fn((value: unknown) => value),
    findOne: jest.fn(),
    save: jest.fn(),
    upsert: jest.fn(),
  };
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
    [BookClubReadingCopyEntity, readingCopyRepository],
    [BookEntity, {}],
  ]);
  const manager = { getRepository: (entity: unknown) => repositories.get(entity) } as unknown as EntityManager;
  let transactionDepth = 0;
  const dataSource = {
    transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => {
      transactionDepth += 1;
      try {
        return await callback(manager);
      } finally {
        transactionDepth -= 1;
      }
    },
  } as unknown as DataSource;
  const bookService = { getBookById: jest.fn() } as unknown as jest.Mocked<BookService>;
  let service: BookClubsService;

  beforeEach(() => {
    jest.clearAllMocks();
    readingCopyRepository.upsert.mockReset().mockResolvedValue(undefined);
    delete process.env.CLOUD_MODE;
    clubRepository.findOne.mockResolvedValue(club);
    memberRepository.findOne.mockReset().mockResolvedValue(membership);
    workRepository.findOne.mockResolvedValue(work);
    readingCopyRepository.findOne.mockReset().mockResolvedValue(undefined);
    readingCopyRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    bookService.getBookById.mockResolvedValue({
      id: bookId,
      title: 'Available local edition',
      author: 'Author',
      summary: 'Private catalog summary',
      uploadedByUserId: userId,
      formats: [{ fileName: 'private-file.epub' }],
    } as never);
    service = new BookClubsService(dataSource, bookService);
  });

  afterAll(() => {
    if (originalCloudMode === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = originalCloudMode;
  });

  it('lets a self-hosted club member select an authorized shared local copy', async () => {
    const result = await service.setReadingCopy(clubId, workId, userId, {
      source: BookClubReadingCopySource.SHARED,
      bookId,
    });

    expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, undefined);
    expect(readingCopyRepository.upsert).toHaveBeenCalledWith(
      { memberId: membership.id, workId, bookId, source: 'shared' },
      ['memberId', 'workId'],
    );
    expect(result).toEqual({
      clubId,
      workId,
      source: 'shared',
      available: true,
      book: { id: bookId, title: 'Available local edition', author: 'Author' },
    });
    expect(JSON.stringify(result)).not.toContain('Private catalog summary');
    expect(JSON.stringify(result)).not.toContain('private-file.epub');
    expect(JSON.stringify(result)).not.toMatch(/annotation|position|history/i);
  });

  it('returns the member-per-work personal-copy association without exposing private book fields', async () => {
    readingCopyRepository.findOne.mockResolvedValue({
      memberId: membership.id,
      workId,
      bookId,
      source: 'personal',
    });
    const result = await service.getReadingCopy(clubId, workId, userId);

    expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, undefined);
    expect(result).toEqual({
      clubId,
      workId,
      source: 'personal',
      available: true,
      book: { id: bookId, title: 'Available local edition', author: 'Author' },
    });
    expect(JSON.stringify(result)).not.toMatch(/summary|uploadedByUserId|formats|annotations|position|history/i);
  });

  it('revalidates private-club membership after the book lookup before returning a copy', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
    memberRepository.findOne.mockResolvedValueOnce(membership).mockResolvedValueOnce(undefined);
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'personal' });

    await expect(service.getReadingCopy(clubId, workId, userId)).rejects.toMatchObject({ status: 404 });

    expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, undefined);
    expect(clubRepository.findOne).toHaveBeenCalledTimes(2);
    expect(readingCopyRepository.findOne).toHaveBeenCalledTimes(1);
  });

  it('does not return a book summary when the reading-copy association changes during lookup', async () => {
    readingCopyRepository.findOne
      .mockResolvedValueOnce({ memberId: membership.id, workId, bookId, source: 'personal' })
      .mockResolvedValueOnce({ memberId: membership.id, workId, bookId: 'replacement-book', source: 'personal' });

    await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
      clubId,
      workId,
      source: 'personal',
      available: false,
      book: null,
    });

    expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, undefined);
    expect(readingCopyRepository.findOne).toHaveBeenCalledTimes(2);
  });

  it('looks up books only after private-club visibility and membership checks finish outside the transaction', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
    bookService.getBookById.mockImplementation((...args) => {
      expect(transactionDepth).toBe(0);
      return {
        id: args[0],
        title: 'Available local edition',
        author: 'Author',
      } as never;
    });

    await service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId });
    expect(clubRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      bookService.getBookById.mock.invocationCallOrder[0],
    );
    expect(memberRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      bookService.getBookById.mock.invocationCallOrder[0],
    );

    jest.clearAllMocks();
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'personal' });
    await service.getReadingCopy(clubId, workId, userId);
    expect(clubRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      bookService.getBookById.mock.invocationCallOrder[0],
    );
    expect(memberRepository.findOne.mock.invocationCallOrder[0]).toBeLessThan(
      bookService.getBookById.mock.invocationCallOrder[0],
    );
  });

  it('rechecks membership under a club lock before writing after book authorization', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
    memberRepository.findOne.mockResolvedValueOnce(membership).mockResolvedValueOnce(undefined);

    await expect(
      service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId }),
    ).rejects.toMatchObject({ status: 404 });

    expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, undefined);
    expect(clubRepository.findOne).toHaveBeenNthCalledWith(2, {
      where: { id: clubId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
  });

  it('lets a self-hosted member switch a work association from shared to personal', async () => {
    await service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.SHARED, bookId });
    await service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId });

    expect(readingCopyRepository.upsert).toHaveBeenNthCalledWith(
      2,
      { memberId: membership.id, workId, bookId, source: 'personal' },
      ['memberId', 'workId'],
    );
  });

  it('rejects a direct Cloud personal-copy ID unless the book access service confirms actor ownership', async () => {
    process.env.CLOUD_MODE = 'true';
    bookService.getBookById.mockImplementation((_id, _viewerUserId, ownerScope) =>
      ownerScope === userId
        ? Promise.reject(new NotFoundException('Book not found'))
        : Promise.resolve({ id: bookId, title: 'Someone else book', author: 'Other author' } as never),
    );
    try {
      await expect(
        service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId }),
      ).rejects.toMatchObject({ status: 404 });
      expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, userId);
      expect(readingCopyRepository.save).not.toHaveBeenCalled();
      expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('does not expose an existing non-owned personal book ID through a Cloud read', async () => {
    process.env.CLOUD_MODE = 'true';
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'personal' });
    bookService.getBookById.mockImplementation((_id, _viewerUserId, ownerScope) =>
      ownerScope === userId
        ? Promise.reject(new NotFoundException('Book not found'))
        : Promise.resolve({ id: bookId, title: 'Someone else book', author: 'Other author' } as never),
    );
    try {
      await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
        clubId,
        workId,
        source: 'none',
        available: false,
        book: null,
      });
      expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, userId);
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('rejects shared-copy selection in Cloud without looking up the submitted book ID', async () => {
    process.env.CLOUD_MODE = 'true';
    try {
      await expect(
        service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.SHARED, bookId }),
      ).rejects.toMatchObject({ status: 403 });
      expect(bookService.getBookById).not.toHaveBeenCalled();
      expect(readingCopyRepository.save).not.toHaveBeenCalled();
      expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('permits a Cloud personal copy only through the actor-owned book scope', async () => {
    process.env.CLOUD_MODE = 'true';
    try {
      await service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId });
      expect(bookService.getBookById).toHaveBeenCalledWith(bookId, userId, userId);
      expect(readingCopyRepository.upsert).toHaveBeenCalledWith(
        { memberId: membership.id, workId, bookId, source: 'personal' },
        ['memberId', 'workId'],
      );
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('does not expose an existing shared association in Cloud', async () => {
    process.env.CLOUD_MODE = 'true';
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'shared' });
    try {
      await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
        clubId,
        workId,
        source: 'none',
        available: false,
        book: null,
      });
      expect(bookService.getBookById).not.toHaveBeenCalled();
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('retains a revoked self-hosted shared association but marks it unavailable on read', async () => {
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'shared' });
    bookService.getBookById.mockRejectedValue(new NotFoundException('Book not found'));

    await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
      clubId,
      workId,
      source: 'shared',
      available: false,
      book: null,
    });
    expect(readingCopyRepository.save).not.toHaveBeenCalled();
  });

  it('keeps the selected source unavailable when a deleted book reference has been nulled', async () => {
    readingCopyRepository.findOne.mockResolvedValue({
      memberId: membership.id,
      workId,
      bookId: null,
      source: 'shared',
    });

    await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
      clubId,
      workId,
      source: 'shared',
      available: false,
      book: null,
    });
    expect(bookService.getBookById).not.toHaveBeenCalled();
  });

  it('retains a self-hosted shared association when current library authorization denies access', async () => {
    readingCopyRepository.findOne.mockResolvedValue({ memberId: membership.id, workId, bookId, source: 'shared' });
    bookService.getBookById.mockRejectedValue(new ForbiddenException('Book access revoked'));

    await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
      clubId,
      workId,
      source: 'shared',
      available: false,
      book: null,
    });
    expect(readingCopyRepository.save).not.toHaveBeenCalled();
  });

  it('does not reveal a private club copy to a non-member', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
    memberRepository.findOne.mockResolvedValue(undefined);

    await expect(service.getReadingCopy(clubId, workId, userId)).rejects.toMatchObject({ status: 404 });
    expect(workRepository.findOne).not.toHaveBeenCalled();
    expect(readingCopyRepository.findOne).not.toHaveBeenCalled();
    expect(bookService.getBookById).not.toHaveBeenCalled();
  });

  it('completes concurrent first-time set and clear requests without a uniqueness failure', async () => {
    type StoredAssociation = {
      id: string;
      memberId: string;
      workId: string;
      bookId: string | null;
      source: string;
    };
    let storedAssociation: StoredAssociation | undefined;
    let readCount = 0;
    let releaseReads: () => void = () => undefined;
    const bothReadsCompleted = new Promise<void>((resolve) => {
      releaseReads = resolve;
    });

    readingCopyRepository.findOne.mockImplementation(async () => {
      const observedAssociation = storedAssociation;
      readCount += 1;
      if (readCount === 2) releaseReads();
      await bothReadsCompleted;
      return observedAssociation;
    });
    readingCopyRepository.save.mockImplementation((value: unknown) => {
      const association = value as StoredAssociation;
      if (storedAssociation) throw new Error('duplicate key violates unique constraint');
      storedAssociation = { ...association, id: 'first-association' };
      return storedAssociation;
    });
    readingCopyRepository.upsert.mockImplementation((value: unknown, conflictPaths: string[]) => {
      const association = value as StoredAssociation;
      expect(conflictPaths).toEqual(['memberId', 'workId']);
      storedAssociation = storedAssociation
        ? { ...storedAssociation, ...association }
        : { ...association, id: 'first-association' };
    });

    const results = await Promise.allSettled([
      service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId }),
      service.clearReadingCopy(clubId, workId, userId),
    ]);

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'fulfilled']);
    expect(storedAssociation).toEqual(
      expect.objectContaining({
        id: 'first-association',
        memberId: membership.id,
        workId,
      }),
    );
    expect(readingCopyRepository.upsert).toHaveBeenCalledTimes(2);
    if (storedAssociation?.source === BookClubReadingCopySource.NONE) {
      expect(storedAssociation.bookId).toBeNull();
    } else {
      expect(storedAssociation).toEqual(
        expect.objectContaining({ source: BookClubReadingCopySource.PERSONAL, bookId }),
      );
    }
    expect(storedAssociation?.id).toBe('first-association');
  });

  it('clears a selection by retaining the member-work row and setting its source to none', async () => {
    readingCopyRepository.findOne.mockResolvedValue({
      id: 'existing-association',
      memberId: membership.id,
      workId,
      bookId,
      source: 'personal',
    });

    await service.clearReadingCopy(clubId, workId, userId);

    expect(clubRepository.findOne).toHaveBeenCalledWith({
      where: { id: clubId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(readingCopyRepository.upsert).toHaveBeenCalledWith(
      { memberId: membership.id, workId, bookId: null, source: 'none' },
      ['memberId', 'workId'],
    );
  });
});
