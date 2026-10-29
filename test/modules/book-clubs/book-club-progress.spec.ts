import { ForbiddenException, GoneException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

type ScheduleProgress = {
  myMappings: Array<{ milestoneId: string; memberLabel: string; memberPosition: number | null }>;
  myProgress: Array<{ milestoneId: string; status: string; percentage: number | null }>;
  sharedProgress: Array<{
    userId: string;
    milestones: Array<{ milestoneId: string; status: string; percentage: number | null }>;
  }>;
};

describe('Book club member progress privacy', () => {
  const clubId = '123e4567-e89b-42d3-a456-426614174011';
  const workId = '123e4567-e89b-42d3-a456-426614174012';
  const milestoneId = '123e4567-e89b-42d3-a456-426614174013';
  const userId = '123e4567-e89b-42d3-a456-426614174014';
  const otherUserId = '123e4567-e89b-42d3-a456-426614174015';
  const club = { id: clubId, visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ACTIVE };
  const member = { id: 'member-1', clubId, userId, role: BookClubRole.MEMBER, progressSharingEnabled: false };
  const milestone = { id: milestoneId, workId, name: 'Chapter 2', kind: 'chapter', position: 1 };
  const clubRepository = { findOne: jest.fn(), save: jest.fn() };
  const memberRepository = { findOne: jest.fn(), find: jest.fn(), save: jest.fn() };
  const workRepository = { findOne: jest.fn(), save: jest.fn() };
  const milestoneRepository = { findOne: jest.fn(), find: jest.fn(), delete: jest.fn() };
  const readingCopyRepository = { findOne: jest.fn(), find: jest.fn(), upsert: jest.fn(), update: jest.fn() };
  const bookRepository = { findOne: jest.fn(), find: jest.fn() };
  const bookService = { getBookById: jest.fn() } as unknown as BookService;
  const progressRepository = { upsert: jest.fn(), find: jest.fn(), findOne: jest.fn(), delete: jest.fn() };
  const mappingRepository = { upsert: jest.fn(), find: jest.fn(), delete: jest.fn() };
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
    [BookClubReadingCopyEntity, readingCopyRepository],
    [BookEntity, bookRepository],
  ]);
  const manager = {
    getRepository: (entity: unknown) => {
      const entityName = (entity as { name?: string }).name;
      if (entityName === 'BookClubMilestoneProgressEntity') return progressRepository;
      if (entityName === 'BookClubMilestoneMappingEntity') return mappingRepository;
      if (entityName === 'BookClubMilestoneEntity') return milestoneRepository;
      return repositories.get(entity);
    },
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => callback(manager),
  } as unknown as DataSource;
  let service: BookClubsService;
  const originalCloudMode = process.env.CLOUD_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    clubRepository.findOne.mockResolvedValue(club);
    clubRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    memberRepository.findOne.mockResolvedValue(member);
    memberRepository.find.mockResolvedValue([member]);
    memberRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    workRepository.findOne.mockResolvedValue({ id: workId, clubId });
    workRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    milestoneRepository.findOne.mockResolvedValue(milestone);
    milestoneRepository.find.mockResolvedValue([milestone]);
    milestoneRepository.delete.mockResolvedValue(undefined);
    readingCopyRepository.findOne.mockResolvedValue({
      id: 'copy-choice',
      memberId: member.id,
      workId,
      bookId: 'private-book-id',
      source: 'personal',
    });
    readingCopyRepository.find.mockResolvedValue([]);
    readingCopyRepository.update.mockResolvedValue(undefined);
    bookRepository.findOne.mockResolvedValue({ id: 'private-book-id' });
    bookRepository.find.mockResolvedValue([
      { id: 'private-book-id' },
      { id: 'other-private-book-id' },
      { id: 'hidden-book-id' },
      { id: 'own-book-id' },
    ]);
    (bookService.getBookById as jest.Mock).mockResolvedValue({ id: 'private-book-id' });
    progressRepository.upsert.mockResolvedValue(undefined);
    progressRepository.find.mockResolvedValue([]);
    progressRepository.findOne.mockResolvedValue(null);
    progressRepository.delete.mockResolvedValue(undefined);
    mappingRepository.upsert.mockResolvedValue(undefined);
    mappingRepository.find.mockResolvedValue([]);
    mappingRepository.delete.mockResolvedValue(undefined);
    service = new BookClubsService(dataSource, bookService);
  });

  afterEach(() => {
    if (originalCloudMode === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = originalCloudMode;
  });

  it.each(['shared', 'personal'])(
    'stores format-neutral progress for a member %s reading-copy choice without locations or book details',
    async (source) => {
      readingCopyRepository.findOne.mockResolvedValue({
        id: 'copy-choice',
        memberId: member.id,
        workId,
        bookId: 'private-book-id',
        source,
      });
      const api = progressService();

      await expect(
        api.setMilestoneMapping(clubId, milestoneId, userId, { memberLabel: 'My Chapter 2', memberPosition: 7 }),
      ).resolves.toEqual({ milestoneId, memberLabel: 'My Chapter 2', memberPosition: 7 });
      await expect(
        api.setMilestoneProgress(clubId, milestoneId, userId, { status: 'in_progress', percentage: 42 }),
      ).resolves.toEqual({ milestoneId, status: 'in_progress', percentage: 42 });

      expect(mappingRepository.upsert).toHaveBeenCalledWith(
        { memberId: member.id, workId, milestoneId, memberLabel: 'My Chapter 2', memberPosition: 7 },
        ['memberId', 'milestoneId'],
      );
      expect(progressRepository.upsert).toHaveBeenCalledWith(
        { memberId: member.id, workId, milestoneId, status: 'in_progress', percentage: 42 },
        ['memberId', 'milestoneId'],
      );
      expect(JSON.stringify([mappingRepository.upsert.mock.calls, progressRepository.upsert.mock.calls])).not.toMatch(
        /private-book-id|cfi|pageNumber|timestamp|annotation|readingHistory/i,
      );
    },
  );

  it('requires the caller to have a selected reading copy before writing milestone progress', async () => {
    readingCopyRepository.findOne.mockResolvedValue({ memberId: member.id, workId, bookId: null, source: 'none' });

    await expect(
      progressService().setMilestoneProgress(clubId, milestoneId, userId, { status: 'completed' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(progressRepository.upsert).not.toHaveBeenCalled();
  });

  it('revalidates Cloud ownership of the selected copy before accepting progress', async () => {
    process.env.CLOUD_MODE = 'true';
    readingCopyRepository.findOne.mockResolvedValue({
      memberId: member.id,
      workId,
      bookId: 'private-book-id',
      source: 'personal',
    });
    bookRepository.findOne.mockResolvedValue(null);

    await expect(
      progressService().setMilestoneProgress(clubId, milestoneId, userId, { status: 'completed' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(bookRepository.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'private-book-id', uploadedByUserId: userId, deletedAt: expect.anything() },
        lock: { mode: 'pessimistic_write' },
      }),
    );
    expect(progressRepository.upsert).not.toHaveBeenCalled();
  });

  it('does not accept progress for a self-hosted shared copy after it is no longer available', async () => {
    delete process.env.CLOUD_MODE;
    readingCopyRepository.findOne.mockResolvedValue({
      memberId: member.id,
      workId,
      bookId: 'private-book-id',
      source: 'shared',
    });
    bookRepository.findOne.mockResolvedValue(null);

    await expect(
      progressService().setMilestoneProgress(clubId, milestoneId, userId, { status: 'in_progress' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(progressRepository.upsert).not.toHaveBeenCalled();
    expect(bookService.getBookById).not.toHaveBeenCalled();
  });

  it('returns every current member regardless of legacy sharing preference without private copy details', async () => {
    const optedIn = { ...member, id: 'member-opted-in', userId: otherUserId, progressSharingEnabled: true };
    const privateProgress = {
      ...member,
      id: 'member-private',
      userId: 'private-reader',
      progressSharingEnabled: false,
    };
    memberRepository.find.mockResolvedValue([member, optedIn, privateProgress]);
    readingCopyRepository.find.mockResolvedValue([
      { memberId: optedIn.id, workId, bookId: 'other-private-book-id', source: 'personal' },
      { memberId: privateProgress.id, workId, bookId: 'hidden-book-id', source: 'personal' },
    ]);
    progressRepository.find.mockResolvedValue([
      { memberId: optedIn.id, milestoneId, status: 'completed', percentage: null },
      { memberId: privateProgress.id, milestoneId, status: 'in_progress', percentage: 65 },
    ]);
    mappingRepository.find.mockResolvedValue([
      { memberId: member.id, milestoneId, memberLabel: 'My own label', memberPosition: 7 },
    ]);

    const schedule = await progressService().getSchedule(clubId, userId);

    expect(schedule).toMatchObject({
      progressSharingEnabled: true,
      sharedProgress: [
        { userId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
        { userId: otherUserId, milestones: [{ milestoneId, status: 'completed', percentage: null }] },
        { userId: privateProgress.userId, milestones: [{ milestoneId, status: 'in_progress', percentage: 65 }] },
      ],
      myMappings: [{ milestoneId, memberLabel: 'My own label', memberPosition: 7 }],
    });
    expect(JSON.stringify(schedule)).not.toMatch(
      /private-book-id|other-private-book-id|hidden-book-id|cfi|pageNumber|timestamp|annotation|readingHistory/i,
    );
  });

  it('revalidates every member selected copy inside the schedule transaction', async () => {
    const optedIn = { ...member, id: 'member-opted-in', userId: otherUserId, progressSharingEnabled: true };
    const optedOut = { ...member, id: 'member-opted-out', userId: 'private-reader', progressSharingEnabled: false };
    memberRepository.find.mockResolvedValue([member, optedIn, optedOut]);
    readingCopyRepository.find.mockResolvedValue([
      { memberId: member.id, workId, bookId: 'own-book-id', source: 'personal' },
      { memberId: optedIn.id, workId, bookId: 'other-private-book-id', source: 'personal' },
      { memberId: optedOut.id, workId, bookId: 'hidden-book-id', source: 'personal' },
    ]);
    progressRepository.find.mockResolvedValue([
      { memberId: optedIn.id, milestoneId, status: 'completed', percentage: null },
      { memberId: optedOut.id, milestoneId, status: 'in_progress', percentage: 65 },
    ]);

    const schedule = await progressService().getSchedule(clubId, userId);

    const [readingCopyQuery] = readingCopyRepository.find.mock.calls[0] as [
      { where: { memberId: { _value: string[] } } },
    ];
    expect(readingCopyQuery.where.memberId._value).toEqual([member.id, optedIn.id, optedOut.id]);
    expect(bookService.getBookById).not.toHaveBeenCalled();
    expect(schedule.sharedProgress).toEqual([
      { userId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
      { userId: otherUserId, milestones: [{ milestoneId, status: 'completed', percentage: null }] },
      { userId: optedOut.userId, milestones: [{ milestoneId, status: 'in_progress', percentage: 65 }] },
    ]);
  });

  it('retains every member but suppresses stale progress when a selected book was soft-deleted', async () => {
    delete process.env.CLOUD_MODE;
    const optedIn = { ...member, id: 'member-opted-in', userId: otherUserId, progressSharingEnabled: true };
    memberRepository.find.mockResolvedValue([member, optedIn]);
    readingCopyRepository.find.mockResolvedValue([
      { memberId: member.id, workId, bookId: 'own-book-id', source: 'personal' },
      { memberId: optedIn.id, workId, bookId: 'deleted-book-id', source: 'personal' },
    ]);
    progressRepository.find.mockResolvedValue([
      { memberId: member.id, milestoneId, status: 'in_progress', percentage: 35 },
      { memberId: optedIn.id, milestoneId, status: 'completed', percentage: null },
    ]);
    (bookService.getBookById as jest.Mock).mockImplementation((bookId: string) => {
      if (bookId === 'deleted-book-id') throw new NotFoundException('Book not found');
      return Promise.resolve({ id: bookId });
    });

    const schedule = await progressService().getSchedule(clubId, userId);

    expect(schedule.sharedProgress).toEqual([
      { userId, milestones: [{ milestoneId, status: 'in_progress', percentage: 35 }] },
      { userId: otherUserId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
    ]);
    expect(JSON.stringify(schedule)).not.toMatch(/deleted-book-id|cfi|pageNumber|timestamp|annotation|readingHistory/i);
    expect(bookService.getBookById).not.toHaveBeenCalled();
    expect(bookRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: expect.anything() }),
        lock: { mode: 'pessimistic_write' },
      }),
    );
  });

  it('suppresses personal progress when a self-hosted member’s selected book was soft-deleted', async () => {
    delete process.env.CLOUD_MODE;
    readingCopyRepository.find.mockResolvedValue([
      { memberId: member.id, workId, bookId: 'deleted-book-id', source: 'personal' },
    ]);
    progressRepository.find.mockResolvedValue([
      { memberId: member.id, milestoneId, status: 'in_progress', percentage: 35 },
    ]);
    (bookService.getBookById as jest.Mock).mockRejectedValue(new NotFoundException('Book not found'));

    const schedule = await progressService().getSchedule(clubId, userId);

    expect(schedule.myProgress).toEqual([]);
    expect(JSON.stringify(schedule)).not.toMatch(/deleted-book-id|cfi|pageNumber|timestamp|annotation|readingHistory/i);
  });

  it('suppresses inaccessible-copy progress without removing members from the progress list', async () => {
    delete process.env.CLOUD_MODE;
    const optedIn = { ...member, id: 'member-opted-in', userId: otherUserId, progressSharingEnabled: true };
    memberRepository.find.mockResolvedValue([member, optedIn]);
    readingCopyRepository.find.mockResolvedValue([
      { memberId: member.id, workId, bookId: 'personal-book-id', source: 'personal' },
      { memberId: optedIn.id, workId, bookId: 'shared-book-id', source: 'shared' },
    ]);
    bookRepository.find.mockResolvedValue([]);

    const schedule = await progressService().getSchedule(clubId, userId);

    expect(bookService.getBookById).not.toHaveBeenCalled();
    expect(bookRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({ select: { id: true, uploadedByUserId: true }, lock: { mode: 'pessimistic_write' } }),
    );
    expect(schedule.myProgress).toEqual([]);
    expect(schedule.sharedProgress).toEqual([
      { userId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
      { userId: otherUserId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
    ]);
    expect(JSON.stringify(schedule)).not.toMatch(
      /personal-book-id|shared-book-id|cfi|pageNumber|timestamp|annotation|readingHistory/i,
    );
  });

  it.each([true, false])(
    'retires the legacy sharing toggle for enabled=%s without mutating membership',
    async (enabled) => {
      await expect(progressService().setProgressSharing(clubId, userId, enabled)).rejects.toBeInstanceOf(GoneException);
      expect(memberRepository.save).not.toHaveBeenCalled();
    },
  );

  it('retires sharing preferences for archived clubs too', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, status: BookClubStatus.ARCHIVED });

    await expect(progressService().setProgressSharing(clubId, userId, false)).rejects.toBeInstanceOf(GoneException);
    await expect(progressService().setProgressSharing(clubId, userId, true)).rejects.toBeInstanceOf(GoneException);
    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it.each([BookClubRole.OWNER, BookClubRole.MODERATOR, BookClubRole.MEMBER])(
    'shows all members, including those without any progress or reading copy, to a %s',
    async (role) => {
      memberRepository.findOne.mockResolvedValue({ ...member, role });
      memberRepository.find.mockResolvedValue([member, { ...member, id: 'new-member', userId: otherUserId }]);
      expect((await progressService().getSchedule(clubId, userId)).sharedProgress).toEqual([
        { userId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
        { userId: otherUserId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
      ]);
      expect(progressRepository.find).not.toHaveBeenCalled();
    },
  );

  it('retains all members when there are no reading steps and on archived clubs', async () => {
    clubRepository.findOne.mockResolvedValue({ ...club, status: BookClubStatus.ARCHIVED });
    milestoneRepository.find.mockResolvedValue([]);
    memberRepository.find.mockResolvedValue([member, { ...member, id: 'new-member', userId: otherUserId }]);
    expect((await progressService().getSchedule(clubId, userId)).sharedProgress).toEqual([
      { userId, milestones: [] },
      { userId: otherUserId, milestones: [] },
    ]);
  });

  it('denies progress and the retired preference endpoint to non-members', async () => {
    memberRepository.findOne.mockResolvedValue(null);
    await expect(progressService().getSchedule(clubId, userId)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(progressService().setProgressSharing(clubId, userId, true)).rejects.toBeInstanceOf(ForbiddenException);
    expect(memberRepository.find).not.toHaveBeenCalled();
  });

  it('does not expose another Cloud member progress after copy ownership changes', async () => {
    process.env.CLOUD_MODE = 'true';
    memberRepository.find.mockResolvedValue([member, { ...member, id: 'other-member', userId: otherUserId }]);
    readingCopyRepository.find.mockResolvedValue([
      { memberId: 'other-member', workId, bookId: 'other-private-book-id', source: 'personal' },
    ]);
    bookRepository.find.mockResolvedValue([{ id: 'other-private-book-id', uploadedByUserId: userId }]);
    progressRepository.find.mockResolvedValue([{ memberId: 'other-member', milestoneId, status: 'completed' }]);
    expect((await progressService().getSchedule(clubId, userId)).sharedProgress).toEqual([
      { userId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
      { userId: otherUserId, milestones: [{ milestoneId, status: 'not_started', percentage: null }] },
    ]);
    expect(progressRepository.find).not.toHaveBeenCalled();
  });

  it('clears edition-specific mappings and progress when a member clears their reading-copy choice', async () => {
    await service.clearReadingCopy(clubId, workId, userId);

    expect(mappingRepository.delete).toHaveBeenCalledWith({ memberId: member.id, workId });
    expect(progressRepository.delete).toHaveBeenCalledWith({ memberId: member.id, workId });
  });

  it('removes the old schedule and resets dates when the club replaces its selected work', async () => {
    clubRepository.findOne.mockResolvedValue({
      ...club,
      ownerUserId: userId,
      startDate: '2026-11-01',
      completionDate: '2026-12-01',
    });
    memberRepository.findOne.mockResolvedValue({ ...member, role: BookClubRole.OWNER });
    workRepository.findOne.mockResolvedValue({ id: workId, clubId, title: 'Old work', author: 'Old author' });

    await service.updateClub(clubId, userId, {
      selectedWork: { title: 'New work', author: 'New author' },
    });

    expect(clubRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: null, completionDate: null }),
    );
    expect(milestoneRepository.delete).toHaveBeenCalledWith({ workId });
  });

  function progressService(): {
    setMilestoneMapping: (club: string, milestone: string, user: string, input: unknown) => Promise<unknown>;
    setMilestoneProgress: (club: string, milestone: string, user: string, input: unknown) => Promise<unknown>;
    setProgressSharing: (club: string, user: string, enabled: boolean) => Promise<unknown>;
    getSchedule: (club: string, user: string) => Promise<ScheduleProgress>;
  } {
    return service as unknown as ReturnType<typeof progressService>;
  }
});
