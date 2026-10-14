import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import {
  BookClubAssociationMethod,
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

  const clubRepository = { findOne: jest.fn(), save: jest.fn() };
  const memberRepository = { findOne: jest.fn() };
  const workRepository = { findOne: jest.fn(), save: jest.fn() };
  const readingCopyRepository = {
    create: jest.fn((value: unknown) => value),
    findOne: jest.fn(),
    save: jest.fn(),
    upsert: jest.fn(),
    update: jest.fn(),
  };
  const bookRepository = { findOne: jest.fn(), find: jest.fn() };
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
    [BookClubReadingCopyEntity, readingCopyRepository],
    [BookEntity, bookRepository],
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
  const bookService = { getBookById: jest.fn(), getMatchingBooks: jest.fn() } as unknown as jest.Mocked<BookService>;
  let service: BookClubsService;

  beforeEach(() => {
    jest.clearAllMocks();
    readingCopyRepository.upsert.mockReset().mockResolvedValue(undefined);
    readingCopyRepository.update.mockReset().mockResolvedValue(undefined);
    delete process.env.CLOUD_MODE;
    clubRepository.findOne.mockResolvedValue(club);
    clubRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    memberRepository.findOne.mockReset().mockResolvedValue(membership);
    workRepository.findOne.mockResolvedValue(work);
    bookRepository.findOne.mockReset().mockResolvedValue({ id: bookId, uploadedByUserId: userId, deletedAt: null });
    bookRepository.find
      .mockReset()
      .mockResolvedValue([{ id: bookId, title: 'Selected logical work', author: 'Author' }]);
    workRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
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
      {
        memberId: membership.id,
        workId,
        bookId,
        source: 'shared',
        associationMethod: 'manual_confirmation',
        confidence: 1,
      },
      ['memberId', 'workId'],
    );
    expect(result).toEqual({
      clubId,
      workId,
      source: 'shared',
      available: true,
      book: { id: bookId, title: 'Available local edition', author: 'Author' },
      associationMethod: 'manual_confirmation',
      confidence: 1,
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

  it('returns only actor-owned Cloud candidates and requires confirmation without exposing file metadata', async () => {
    process.env.CLOUD_MODE = 'true';
    bookService.getMatchingBooks.mockResolvedValue([
      {
        id: bookId,
        title: 'Selected logical work',
        author: 'Author',
        isbn: '9780000000000',
        fileContentHash: 'private-hash',
        formats: [{ fileName: 'private.epub' }],
      } as never,
    ]);

    const result = await (
      service as unknown as {
        getWorkMatchCandidates: (club: string, work: string, user: string) => Promise<unknown[]>;
      }
    ).getWorkMatchCandidates(clubId, workId, userId);

    expect(bookService.getMatchingBooks).toHaveBeenCalledWith(work, userId);
    expect(result).toEqual([
      {
        bookId,
        title: 'Selected logical work',
        author: 'Author',
        method: 'metadata_candidate',
        confidence: 0.75,
        confirmationRequired: true,
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/private-hash|private\.epub|isbn|format/i);
  });

  it('revalidates Cloud candidate ownership and deletion after lookup before disclosing title or author', async () => {
    process.env.CLOUD_MODE = 'true';
    const matchingWork = { ...work, externalWorkId: 'shared-work-id' };
    const candidates = ['book-1', 'book-2', 'book-3', 'book-4'].map((id) => ({
      id,
      title: `Candidate title ${id}`,
      author: `Candidate author ${id}`,
      externalWorkId: 'shared-work-id',
    }));
    let liveBooks: Array<{
      id: string;
      uploadedByUserId: string;
      deletedAt: Date | null;
      title?: string;
      author?: string;
    }> = candidates.map(({ id, title, author }) => ({ id, title, author, uploadedByUserId: userId, deletedAt: null }));
    let workReadCount = 0;
    let raceApplied = false;
    const candidateBookFindOptions: unknown[] = [];
    workRepository.findOne.mockImplementation(() => {
      workReadCount += 1;
      if (workReadCount === 2 && !raceApplied) {
        raceApplied = true;
        liveBooks = [
          {
            id: 'book-1',
            uploadedByUserId: 'another-user',
            deletedAt: null,
            title: 'Candidate title book-1',
            author: 'Candidate author book-1',
          },
          {
            id: 'book-2',
            uploadedByUserId: userId,
            deletedAt: new Date(),
            title: 'Candidate title book-2',
            author: 'Candidate author book-2',
          },
          {
            id: 'book-3',
            uploadedByUserId: userId,
            deletedAt: null,
            title: 'Current title book-3',
            author: 'Current author book-3',
          },
          {
            id: 'book-4',
            uploadedByUserId: userId,
            deletedAt: null,
            title: 'Current title book-4',
            author: 'Current author book-4',
          },
        ];
      }
      return Promise.resolve(matchingWork);
    });
    bookRepository.find.mockImplementation((options: unknown) => {
      candidateBookFindOptions.push(options);
      return Promise.resolve(liveBooks.filter((book) => book.uploadedByUserId === userId && book.deletedAt === null));
    });
    bookService.getMatchingBooks.mockResolvedValue(candidates as never);

    const result = await service.getWorkMatchCandidates(clubId, workId, userId);

    expect(result.map((candidate) => candidate.bookId)).toEqual(['book-3', 'book-4']);
    expect(result.map(({ title, author }) => [title, author])).toEqual([
      ['Current title book-3', 'Current author book-3'],
      ['Current title book-4', 'Current author book-4'],
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Candidate title book-[12]|Candidate author book-[12]/);
    const queryOptions = candidateBookFindOptions[0] as {
      where: Record<string, unknown>;
      lock: { mode: string };
    };
    expect(queryOptions.where.uploadedByUserId).toBe(userId);
    expect(queryOptions.where).toHaveProperty('deletedAt');
    expect(queryOptions.lock.mode).toBe('pessimistic_write');

    liveBooks = [];
    await expect(service.getWorkMatchCandidates(clubId, workId, userId)).resolves.toEqual([]);
  });

  it('persists identifier evidence only after the member confirms the candidate', async () => {
    workRepository.findOne.mockResolvedValue({ ...work, externalWorkId: 'work-identifier' });
    bookService.getMatchingBooks.mockResolvedValue([
      { id: bookId, title: 'Translated title', author: 'Author', externalWorkId: 'work-identifier' } as never,
    ]);
    bookService.getBookById.mockResolvedValueOnce({
      id: bookId,
      title: 'Translated title',
      author: 'Author',
      externalWorkId: 'work-identifier',
      formats: [],
    } as never);

    const result = await (
      service as unknown as {
        confirmWorkMatch: (club: string, work: string, user: string, book: string) => Promise<unknown>;
      }
    ).confirmWorkMatch(clubId, workId, userId, bookId);

    expect(readingCopyRepository.upsert).toHaveBeenCalledWith(
      {
        memberId: membership.id,
        workId,
        bookId,
        source: 'personal',
        associationMethod: 'identifier',
        confidence: 1,
      },
      ['memberId', 'workId'],
    );
    expect(result).toMatchObject({ associationMethod: 'identifier', confidence: 1, book: { id: bookId } });
  });

  it('does not return match candidates if private-club membership is revoked during lookup', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
    memberRepository.findOne.mockResolvedValueOnce(membership).mockResolvedValueOnce(undefined);
    bookService.getMatchingBooks.mockResolvedValue([
      { id: bookId, title: 'Selected logical work', author: 'Author' } as never,
    ]);

    await expect(
      (
        service as unknown as {
          getWorkMatchCandidates: (club: string, work: string, user: string) => Promise<unknown[]>;
        }
      ).getWorkMatchCandidates(clubId, workId, userId),
    ).rejects.toMatchObject({ status: 404 });
    expect(bookService.getMatchingBooks).toHaveBeenCalledWith(work, userId);
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
      {
        memberId: membership.id,
        workId,
        bookId,
        source: 'personal',
        associationMethod: 'manual_confirmation',
        confidence: 1,
      },
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

  it.each(['reassignment', 'deletion'] as const)(
    'does not disclose a stale Cloud book after %s between lookup and response',
    async (change) => {
      process.env.CLOUD_MODE = 'true';
      const association = {
        id: 'reading-copy-association',
        memberId: membership.id,
        workId,
        bookId,
        source: BookClubReadingCopySource.PERSONAL,
        associationMethod: BookClubAssociationMethod.MANUAL_CONFIRMATION,
        confidence: 1,
      };
      readingCopyRepository.findOne.mockResolvedValue(association);
      let liveBook = { id: bookId, uploadedByUserId: userId, deletedAt: null as Date | null };
      bookService.getBookById.mockImplementation(() => {
        expect(transactionDepth).toBe(0);
        const lookedUpBook = {
          id: bookId,
          title: 'Stale private title',
          author: 'Stale private author',
        };
        liveBook = {
          ...liveBook,
          ...(change === 'reassignment' ? { uploadedByUserId: 'new-owner' } : { deletedAt: new Date() }),
        };
        return Promise.resolve(lookedUpBook as never);
      });
      bookRepository.findOne.mockImplementation(({ where }: { where: { id: string; uploadedByUserId: string } }) => {
        expect(transactionDepth).toBe(1);
        return Promise.resolve(
          liveBook.id === where.id && liveBook.uploadedByUserId === where.uploadedByUserId && !liveBook.deletedAt
            ? { ...liveBook, title: 'Stale private title', author: 'Stale private author' }
            : null,
        );
      });

      try {
        await expect(service.getReadingCopy(clubId, workId, userId)).resolves.toEqual({
          clubId,
          workId,
          source: BookClubReadingCopySource.NONE,
          available: false,
          book: null,
        });

        const [authorizationQuery] = bookRepository.findOne.mock.calls[0] as [
          {
            select: { id: boolean; title: boolean; author: boolean };
            where: { id: string; uploadedByUserId: string; deletedAt: unknown };
            lock: { mode: string };
          },
        ];
        expect(authorizationQuery.where).toMatchObject({ id: bookId, uploadedByUserId: userId });
        expect(authorizationQuery.where).toHaveProperty('deletedAt');
        expect(authorizationQuery.lock.mode).toBe('pessimistic_write');
        expect(authorizationQuery.select).toEqual({ id: true, title: true, author: true });
      } finally {
        delete process.env.CLOUD_MODE;
      }
    },
  );

  it('resets every member association and its match evidence when the selected logical work is replaced', async () => {
    const owner = { id: 'owner-membership', clubId, userId, role: BookClubRole.OWNER };
    const otherMember = { id: 'other-membership', clubId, userId: 'other-reader', role: BookClubRole.MEMBER };
    const clubWithOwner = {
      ...club,
      ownerUserId: userId,
      name: 'Reading group',
      status: BookClubStatus.ACTIVE,
    };
    let selectedWork = { ...work, title: 'Original title', author: 'Original author', externalWorkId: 'work-old' };
    const storedAssociations: Array<{
      id: string;
      memberId: string;
      workId: string;
      bookId: string | null;
      source: BookClubReadingCopySource;
      associationMethod: BookClubAssociationMethod | null;
      confidence: number | null;
    }> = [];
    let associationId = 0;

    clubRepository.findOne.mockResolvedValue(clubWithOwner);
    memberRepository.findOne.mockImplementation(({ where }: { where: { userId: string } }) =>
      Promise.resolve(where.userId === userId ? owner : otherMember),
    );
    workRepository.findOne.mockImplementation(() => Promise.resolve(selectedWork));
    workRepository.save.mockImplementation((value: unknown) => {
      selectedWork = value as typeof selectedWork;
      return Promise.resolve(value);
    });
    readingCopyRepository.upsert.mockImplementation((value: unknown) => {
      const association = value as Omit<(typeof storedAssociations)[number], 'id'>;
      const existingIndex = storedAssociations.findIndex(
        (stored) => stored.memberId === association.memberId && stored.workId === association.workId,
      );
      if (existingIndex === -1) storedAssociations.push({ ...association, id: `association-${++associationId}` });
      else storedAssociations[existingIndex] = { ...storedAssociations[existingIndex], ...association };
      return Promise.resolve(undefined);
    });
    readingCopyRepository.findOne.mockImplementation(({ where }: { where: { memberId: string; workId: string } }) =>
      Promise.resolve(
        storedAssociations.find((stored) => stored.memberId === where.memberId && stored.workId === where.workId),
      ),
    );
    readingCopyRepository.update.mockImplementation(
      ({ workId: targetWorkId }: { workId: string }, changes: Partial<(typeof storedAssociations)[number]>) => {
        for (const association of storedAssociations) {
          if (association.workId === targetWorkId) Object.assign(association, changes);
        }
        return Promise.resolve(undefined);
      },
    );

    await service.setReadingCopy(
      clubId,
      workId,
      userId,
      { source: BookClubReadingCopySource.PERSONAL, bookId },
      { associationMethod: BookClubAssociationMethod.IDENTIFIER, confidence: 1 },
    );
    await service.setReadingCopy(
      clubId,
      workId,
      otherMember.userId,
      { source: BookClubReadingCopySource.PERSONAL, bookId },
      { associationMethod: BookClubAssociationMethod.METADATA_CANDIDATE, confidence: 0.75 },
    );

    await service.updateClub(clubId, userId, {
      selectedWork: { title: 'Replacement title', author: 'Replacement author', externalWorkId: 'work-new' },
    });

    expect(storedAssociations).toEqual([
      expect.objectContaining({
        id: 'association-1',
        memberId: owner.id,
        workId,
        bookId: null,
        source: BookClubReadingCopySource.NONE,
        associationMethod: null,
        confidence: null,
      }),
      expect.objectContaining({
        id: 'association-2',
        memberId: otherMember.id,
        workId,
        bookId: null,
        source: BookClubReadingCopySource.NONE,
        associationMethod: null,
        confidence: null,
      }),
    ]);

    bookService.getBookById.mockClear();
    await expect(service.getReadingCopy(clubId, workId, otherMember.userId)).resolves.toEqual({
      clubId,
      workId,
      source: BookClubReadingCopySource.NONE,
      available: false,
      book: null,
    });
    expect(bookService.getBookById).not.toHaveBeenCalled();
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
        {
          memberId: membership.id,
          workId,
          bookId,
          source: 'personal',
          associationMethod: 'manual_confirmation',
          confidence: 1,
        },
        ['memberId', 'workId'],
      );
    } finally {
      delete process.env.CLOUD_MODE;
    }
  });

  it('rejects a Cloud association when book ownership changes after lookup but before the write', async () => {
    process.env.CLOUD_MODE = 'true';
    let currentOwnerId = userId;
    const lookedUpBook = {
      id: bookId,
      title: 'Available local edition',
      author: 'Author',
      uploadedByUserId: userId,
      deletedAt: null,
    };
    bookService.getBookById.mockImplementation((id, _viewerUserId, ownerScope) => {
      expect(ownerScope).toBe(userId);
      currentOwnerId = 'reassigned-owner';
      return Promise.resolve({ ...lookedUpBook, id } as never);
    });
    bookRepository.findOne.mockImplementation(({ where }: { where: { uploadedByUserId: string } }) =>
      Promise.resolve(currentOwnerId === where.uploadedByUserId ? lookedUpBook : null),
    );

    try {
      await expect(
        service.setReadingCopy(clubId, workId, userId, { source: BookClubReadingCopySource.PERSONAL, bookId }),
      ).rejects.toMatchObject({ status: 404 });

      expect(bookRepository.findOne).toHaveBeenCalledTimes(1);
      const [authorizationQuery] = bookRepository.findOne.mock.calls[0] as [
        { where: { id: string; uploadedByUserId: string }; lock: { mode: string } },
      ];
      expect(authorizationQuery.where.id).toBe(bookId);
      expect(authorizationQuery.where.uploadedByUserId).toBe(userId);
      expect(authorizationQuery.lock.mode).toBe('pessimistic_write');
      expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
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
      {
        memberId: membership.id,
        workId,
        bookId: null,
        source: 'none',
        associationMethod: null,
        confidence: null,
      },
      ['memberId', 'workId'],
    );
  });
});
