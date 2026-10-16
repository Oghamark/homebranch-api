import { DataSource, EntityManager, getMetadataArgsStorage } from 'typeorm';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubMilestoneEntity } from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookEntity } from 'src/modules/book/book.entity';

describe('BookClubsService', () => {
  const clubRepository = {
    create: jest.fn((value: unknown): unknown => value),
    save: jest.fn((value: unknown): Promise<unknown> => Promise.resolve(value)),
    findOne: jest.fn<Promise<unknown>, [unknown]>(),
    find: jest.fn<Promise<unknown[]>, [unknown]>(),
    delete: jest.fn<Promise<unknown>, [unknown]>(),
  };
  const memberRepository = {
    create: jest.fn((value: unknown): unknown => value),
    save: jest.fn((value: unknown): Promise<unknown> => Promise.resolve(value)),
    findOne: jest.fn<Promise<unknown>, [unknown]>(),
    find: jest.fn<Promise<unknown[]>, [unknown]>(),
    delete: jest.fn<Promise<unknown>, [unknown]>(),
  };
  const workRepository = {
    create: jest.fn((value: unknown): unknown => value),
    save: jest.fn((value: unknown): Promise<unknown> => Promise.resolve(value)),
    findOne: jest.fn<Promise<unknown>, [unknown]>(),
    find: jest.fn<Promise<unknown[]>, [unknown]>(),
  };
  const readingCopyRepository = {
    upsert: jest.fn<Promise<unknown>, [unknown, unknown]>(),
    update: jest.fn<Promise<unknown>, [unknown, unknown]>(),
  };
  const milestoneRepository = { delete: jest.fn<Promise<unknown>, [unknown]>() };
  const bookRepository = { find: jest.fn<Promise<unknown[]>, [unknown]>() };
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
    [BookClubReadingCopyEntity, readingCopyRepository],
    [BookClubMilestoneEntity, milestoneRepository],
    [BookEntity, bookRepository],
  ]);
  const manager = {
    getRepository: (entity: unknown) => repositories.get(entity),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => callback(manager),
  } as unknown as DataSource;

  let service: BookClubsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clubRepository.findOne.mockReset().mockResolvedValue(undefined);
    memberRepository.findOne.mockReset().mockResolvedValue(undefined);
    workRepository.findOne.mockReset().mockResolvedValue(undefined);
    readingCopyRepository.upsert.mockReset().mockResolvedValue({});
    readingCopyRepository.update.mockReset().mockResolvedValue({});
    milestoneRepository.delete.mockReset().mockResolvedValue({ affected: 0 });
    clubRepository.find.mockReset().mockResolvedValue([]);
    clubRepository.delete.mockReset().mockResolvedValue({ affected: 1 });
    memberRepository.find.mockReset().mockResolvedValue([]);
    workRepository.find.mockReset().mockResolvedValue([]);
    bookRepository.find.mockReset().mockResolvedValue([]);
    service = new BookClubsService(dataSource);
  });

  it.each([BookClubRole.OWNER, BookClubRole.MODERATOR, BookClubRole.MEMBER])(
    'returns only user IDs and club roles to a club %s',
    async (role) => {
      const club = {
        id: 'club-1',
        visibility: BookClubVisibility.PRIVATE,
        status: BookClubStatus.ACTIVE,
      };
      clubRepository.findOne.mockResolvedValue(club);
      memberRepository.findOne.mockResolvedValue({
        clubId: club.id,
        userId: 'moderator-1',
        role,
      });
      memberRepository.find.mockResolvedValue([
        { userId: 'owner-1', role: BookClubRole.OWNER, personalBookId: 'private-book', progressSharingEnabled: true },
        {
          userId: 'member-1',
          role: BookClubRole.MEMBER,
          personalBookId: 'another-private-book',
          progressSharingEnabled: false,
        },
      ]);

      const roster = await service.listMembers(club.id, 'moderator-1');

      expect(roster).toEqual([
        { userId: 'owner-1', role: BookClubRole.OWNER },
        { userId: 'member-1', role: BookClubRole.MEMBER },
      ]);
      expect(memberRepository.find).toHaveBeenCalledWith({
        select: { userId: true, role: true },
        where: { clubId: club.id },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    },
  );

  it('serializes roster access behind concurrent membership revocation', async () => {
    const club = { id: 'club-1', visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE };
    let revoked = false;
    clubRepository.findOne.mockImplementation((options: unknown) => {
      if ((options as { lock?: { mode: string } }).lock?.mode === 'pessimistic_write') {
        revoked = true;
      }
      return Promise.resolve(club);
    });
    memberRepository.findOne.mockImplementation(() =>
      Promise.resolve(revoked ? undefined : { clubId: club.id, userId: 'moderator-1', role: BookClubRole.MODERATOR }),
    );

    await expect(service.listMembers(club.id, 'moderator-1')).rejects.toMatchObject({ status: 404 });
    expect(memberRepository.find).not.toHaveBeenCalled();
  });

  it('rejects visible-club non-members without reading the roster', async () => {
    const club = {
      id: 'club-1',
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    };
    clubRepository.findOne.mockResolvedValue(club);
    await expect(service.listMembers(club.id, 'outsider')).rejects.toMatchObject({ status: 403 });
    expect(memberRepository.find).not.toHaveBeenCalled();
  });

  it('allows an ordinary member to read an archived club roster without granting management permissions', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ARCHIVED,
    });
    memberRepository.findOne.mockResolvedValue({
      clubId: 'club-1',
      userId: 'reader',
      role: BookClubRole.MEMBER,
    });
    memberRepository.find.mockResolvedValue([{ userId: 'reader', role: BookClubRole.MEMBER }]);
    await expect(service.listMembers('club-1', 'reader')).resolves.toEqual([
      { userId: 'reader', role: BookClubRole.MEMBER },
    ]);
    expect(memberRepository.save).not.toHaveBeenCalled();
    expect(memberRepository.delete).not.toHaveBeenCalled();
  });

  it('keeps logical selected work separate from a future per-member personal-copy reference', () => {
    const memberProperties = getMetadataArgsStorage()
      .columns.filter((column) => column.target === BookClubMemberEntity)
      .map((column) => column.propertyName);
    const workProperties = getMetadataArgsStorage()
      .columns.filter((column) => column.target === BookClubWorkEntity)
      .map((column) => column.propertyName);

    expect(memberProperties).toContain('personalBookId');
    expect(workProperties).not.toContain('personalBookId');
    expect(workProperties).not.toContain('bookId');
    expect(workProperties).not.toContain('fileContentHash');
  });

  it('allows self-joining instance-visible clubs but not private clubs', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    });
    memberRepository.findOne.mockResolvedValue(undefined);

    await service.joinClub('club-1', 'reader-1');
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: 'club-1', userId: 'reader-1', role: BookClubRole.MEMBER }),
    );

    clubRepository.findOne.mockResolvedValue({
      id: 'private-club',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    });
    await expect(service.joinClub('private-club', 'reader-2')).rejects.toThrow('Book club not found');
  });

  it('lists instance-visible clubs and only the private clubs the caller belongs to', async () => {
    clubRepository.find.mockResolvedValue([
      { id: 'visible', visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ACTIVE },
      { id: 'private-member', visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
      { id: 'private-other', visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
      { id: 'archived', visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ARCHIVED },
    ]);
    memberRepository.find.mockResolvedValue([
      { clubId: 'private-member', userId: 'viewer', role: BookClubRole.MEMBER },
    ]);
    workRepository.find.mockResolvedValue([
      { clubId: 'visible', title: 'Work A' },
      { clubId: 'private-member', title: 'Work B' },
    ]);

    const clubs = await service.listClubs('viewer');
    expect(clubs.map((club) => club.id)).toEqual(['visible', 'private-member']);
    expect(clubs[1].selectedWork.title).toBe('Work B');
    expect(clubs.map((club) => club.currentMembershipRole)).toEqual([null, BookClubRole.MEMBER]);
  });

  describe('club cover artwork', () => {
    const work = { id: 'work-1', clubId: 'club-1', title: 'The Orchard', author: 'A. Writer', isbn: '9781234567890' };
    const club = {
      id: 'club-1',
      ownerUserId: 'owner',
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    };
    const coverBook = { id: 'book-1', title: work.title, author: work.author, coverImageFileName: 'orchard.jpg' };
    const originalCloudMode = process.env.CLOUD_MODE;

    beforeEach(() => {
      process.env.CLOUD_MODE = 'false';
      clubRepository.find.mockResolvedValue([club]);
      clubRepository.findOne.mockResolvedValue({ ...club });
      workRepository.find.mockResolvedValue([work]);
      workRepository.findOne.mockResolvedValue(work);
      bookRepository.find.mockResolvedValue([coverBook]);
    });

    afterEach(() => {
      if (originalCloudMode === undefined) delete process.env.CLOUD_MODE;
      else process.env.CLOUD_MODE = originalCloudMode;
    });

    it('uses actual artwork for existing clubs without exposing a source book or choosing a reading copy', async () => {
      const [result] = await service.listClubs('viewer');
      expect(result.selectedWork).toEqual({ ...work, coverImageFileName: 'orchard.jpg' });
      expect(result.selectedWork).not.toHaveProperty('bookId');
      expect(result.selectedWork).not.toHaveProperty('fileName');
      expect(result.selectedWork).not.toHaveProperty('formats');
      expect(work).not.toHaveProperty('coverImageFileName');
      expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
      expect(workRepository.save).not.toHaveBeenCalled();
    });

    it('batches artwork lookup across visible clubs and never queries a concealed club work', async () => {
      clubRepository.find.mockResolvedValue([
        club,
        { ...club, id: 'club-2' },
        {
          ...club,
          id: 'hidden-club',
          visibility: BookClubVisibility.PRIVATE,
        },
      ]);
      workRepository.find.mockResolvedValue([work, { ...work, id: 'work-2', clubId: 'club-2', title: 'Another Book' }]);
      const result = await service.listClubs('viewer');
      expect(result).toHaveLength(2);
      expect(bookRepository.find).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(bookRepository.find.mock.calls)).not.toContain('hidden-club');
    });

    it('prioritizes identifier-matched artwork over another edition matched only by title and author', async () => {
      bookRepository.find.mockResolvedValue([
        { ...coverBook, id: 'a', coverImageFileName: 'other-edition.jpg' },
        { ...coverBook, id: 'z', isbn: work.isbn, coverImageFileName: 'exact-edition.jpg' },
      ]);
      expect((await service.getClub(club.id, 'viewer')).selectedWork.coverImageFileName).toBe('exact-edition.jpg');
    });

    it('uses matching format artwork rather than an unrelated parent cover', async () => {
      bookRepository.find.mockResolvedValue([
        {
          ...coverBook,
          title: 'A Different Work',
          coverImageFileName: 'wrong.jpg',
          formats: [{ ...coverBook, id: 'format-1', isbn: work.isbn, coverImageFileName: 'format-cover.jpg' }],
        },
      ]);
      expect((await service.getClub(club.id, 'viewer')).selectedWork.coverImageFileName).toBe('format-cover.jpg');
    });

    it('leaves artwork absent when no matching edition has an image', async () => {
      bookRepository.find.mockResolvedValue([
        { ...coverBook, coverImageFileName: null },
        { ...coverBook, id: 'wrong-work', externalWorkId: 'other-work', title: 'An Unrelated Book' },
      ]);
      expect((await service.getClub(club.id, 'viewer')).selectedWork.coverImageFileName).toBeUndefined();
    });

    it('restricts every Cloud lookup branch to the caller and excludes deleted books and private file metadata', async () => {
      process.env.CLOUD_MODE = 'true';
      await service.getClub(club.id, 'viewer');
      expect(bookRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({ fileName: true, uploadedByUserId: true }),
          where: expect.arrayContaining([
            expect.objectContaining({ title: expect.anything() }),
            expect.objectContaining({ isbn: work.isbn }),
            expect.objectContaining({ formats: { isbn: work.isbn } }),
          ]),
        }),
      );
      const options = bookRepository.find.mock.calls[0][0] as {
        where: Array<{ uploadedByUserId: string; deletedAt: { type: string } }>;
      };
      expect(options.where.length).toBeGreaterThan(0);
      for (const branch of options.where) {
        expect(branch.uploadedByUserId).toBe('viewer');
        expect(branch.deletedAt.type).toBe('isNull');
      }
    });

    it('does not look up artwork when a private club is inaccessible', async () => {
      clubRepository.findOne.mockResolvedValue({ ...club, visibility: BookClubVisibility.PRIVATE });
      await expect(service.getClub(club.id, 'viewer')).rejects.toMatchObject({ status: 404 });
      expect(bookRepository.find).not.toHaveBeenCalled();
    });

    it('includes artwork in archived club and creation responses', async () => {
      memberRepository.find.mockResolvedValue([{ clubId: club.id, userId: 'viewer', role: BookClubRole.MEMBER }]);
      expect((await service.listArchivedClubs('viewer'))[0].selectedWork.coverImageFileName).toBe('orchard.jpg');
      const created = await service.createClub('viewer', {
        name: 'Orchard readers',
        visibility: BookClubVisibility.INSTANCE_VISIBLE,
        selectedWork: { title: work.title, author: work.author, isbn: work.isbn },
      });
      expect(created.selectedWork.coverImageFileName).toBe('orchard.jpg');
    });
  });

  it('lists only archived clubs that the caller belongs to', async () => {
    memberRepository.find.mockResolvedValue([
      { clubId: 'archived-member', userId: 'viewer', role: BookClubRole.MODERATOR },
      { clubId: 'active-member', userId: 'viewer' },
    ]);
    clubRepository.find.mockResolvedValue([
      { id: 'archived-member', status: BookClubStatus.ARCHIVED },
      { id: 'archived-other', status: BookClubStatus.ARCHIVED },
    ]);
    workRepository.find.mockResolvedValue([{ clubId: 'archived-member', title: 'Archived work' }]);

    const clubs = await service.listArchivedClubs('viewer');

    expect(clubs).toEqual([
      expect.objectContaining({
        id: 'archived-member',
        selectedWork: { clubId: 'archived-member', title: 'Archived work' },
        currentMembershipRole: BookClubRole.MODERATOR,
      }),
    ]);
    expect(clubRepository.find).toHaveBeenCalledWith({
      where: { id: expect.anything(), status: BookClubStatus.ARCHIVED },
      order: { createdAt: 'DESC' },
    });
  });

  it('allows only the owner to archive a club', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      ownerUserId: 'owner-1',
      status: BookClubStatus.ACTIVE,
    });
    memberRepository.findOne.mockResolvedValue({ clubId: 'club-1', userId: 'owner-1', role: BookClubRole.OWNER });

    await service.archiveClub('club-1', 'owner-1');
    expect(clubRepository.save).toHaveBeenCalledWith(expect.objectContaining({ status: BookClubStatus.ARCHIVED }));

    memberRepository.findOne.mockResolvedValue({
      clubId: 'club-1',
      userId: 'moderator-1',
      role: BookClubRole.MODERATOR,
    });
    await expect(service.archiveClub('club-1', 'moderator-1')).rejects.toThrow(
      'Only the club owner can perform this action',
    );
  });

  it('allows only the owner to grant or revoke moderator status', async () => {
    clubRepository.findOne.mockResolvedValue({ id: 'club-1', ownerUserId: 'owner-1', status: 'active' });
    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'owner-1', role: BookClubRole.OWNER })
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'member-2', role: BookClubRole.MEMBER });

    await service.updateMemberRole('club-1', 'owner-1', 'member-2', BookClubRole.MODERATOR);
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'member-2', role: BookClubRole.MODERATOR }),
    );

    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-1', role: BookClubRole.MODERATOR })
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'member-2', role: BookClubRole.MEMBER });
    await expect(service.updateMemberRole('club-1', 'moderator-1', 'member-2', BookClubRole.MODERATOR)).rejects.toThrow(
      'Only the club owner can perform this action',
    );
  });

  it('lets moderators remove members but not other moderators or the owner', async () => {
    clubRepository.findOne.mockResolvedValue({ id: 'club-1', ownerUserId: 'owner-1', status: 'active' });
    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-1', role: BookClubRole.MODERATOR })
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'member-2', role: BookClubRole.MEMBER });

    await service.removeMember('club-1', 'moderator-1', 'member-2');
    expect(memberRepository.delete).toHaveBeenCalledWith({ clubId: 'club-1', userId: 'member-2' });

    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-1', role: BookClubRole.MODERATOR })
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-2', role: BookClubRole.MODERATOR });
    await expect(service.removeMember('club-1', 'moderator-1', 'moderator-2')).rejects.toThrow(
      'Moderators can only remove members',
    );
  });

  it('transfers ownership only through club membership and demotes the previous owner', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      ownerUserId: 'owner-1',
      status: 'active',
      visibility: BookClubVisibility.PRIVATE,
    });
    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'owner-1', role: BookClubRole.OWNER })
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'member-2', role: BookClubRole.MEMBER });

    await service.transferOwnership('club-1', 'owner-1', 'member-2');

    expect(clubRepository.save).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'member-2' }));
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'owner-1', role: BookClubRole.MEMBER }),
    );
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'member-2', role: BookClubRole.OWNER }),
    );
  });

  it('does not let a demoted owner add a member using permissions read before a concurrent ownership transfer', async () => {
    const club = { id: 'club-1', ownerUserId: 'owner-1', status: BookClubStatus.ACTIVE };
    let actorRole = BookClubRole.OWNER;
    let transferCommitted = false;
    clubRepository.findOne.mockImplementation((options: unknown) => {
      const lockMode = (options as { lock?: { mode: string } }).lock?.mode;
      if (lockMode === 'pessimistic_write') {
        actorRole = BookClubRole.MEMBER;
        club.ownerUserId = 'owner-2';
        transferCommitted = true;
      }
      return Promise.resolve(club);
    });
    memberRepository.findOne.mockImplementation((criteria: unknown) => {
      const userId = (criteria as { where: { userId: string } }).where.userId;
      if (userId !== 'owner-1') return Promise.resolve(undefined);

      const actor = { clubId: 'club-1', userId, role: actorRole };
      if (!transferCommitted) {
        actorRole = BookClubRole.MEMBER;
        club.ownerUserId = 'owner-2';
        transferCommitted = true;
      }
      return Promise.resolve(actor);
    });

    await expect(
      service.addMember('club-1', 'owner-1', { userId: 'new-moderator', role: BookClubRole.MODERATOR }),
    ).rejects.toThrow('Direct member addition has retired');
    expect(memberRepository.save).not.toHaveBeenCalled();
  });

  it('retires direct additions for owners and moderators without creating memberships', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      ownerUserId: 'owner-1',
      status: 'active',
      visibility: BookClubVisibility.PRIVATE,
    });
    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'owner-1', role: 'owner' })
      .mockResolvedValueOnce(undefined);

    await expect(
      service.addMember('club-1', 'owner-1', { userId: 'moderator-2', role: BookClubRole.MODERATOR }),
    ).rejects.toMatchObject({ status: 410 });
    expect(memberRepository.save).not.toHaveBeenCalled();

    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-1', role: BookClubRole.MODERATOR })
      .mockResolvedValueOnce(undefined);
    await expect(
      service.addMember('club-1', 'moderator-1', { userId: 'moderator-3', role: BookClubRole.MODERATOR }),
    ).rejects.toMatchObject({ status: 410 });
  });

  it('allows the owner to update club settings but not a moderator', async () => {
    const club = {
      id: 'club-1',
      ownerUserId: 'owner-1',
      name: 'Old name',
      visibility: BookClubVisibility.PRIVATE,
      status: 'active',
    };
    clubRepository.findOne.mockResolvedValue(club);
    memberRepository.findOne.mockResolvedValue({ clubId: 'club-1', userId: 'owner-1', role: 'owner' });

    await service.updateClub('club-1', 'owner-1', { name: 'New name' });
    expect(clubRepository.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'New name' }));
    expect(readingCopyRepository.update).not.toHaveBeenCalled();

    memberRepository.findOne.mockResolvedValue({
      clubId: 'club-1',
      userId: 'moderator-1',
      role: BookClubRole.MODERATOR,
    });
    await expect(service.updateClub('club-1', 'moderator-1', { name: 'Unauthorized' })).rejects.toThrow(
      'Only the club owner can perform this action',
    );
  });

  it('clears omitted work identifiers when the selected logical work is replaced', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    });
    memberRepository.findOne.mockResolvedValue({ clubId: 'club-1', userId: 'owner-1', role: BookClubRole.OWNER });
    workRepository.findOne.mockResolvedValue({
      id: 'work-1',
      clubId: 'club-1',
      title: 'Old work',
      author: 'Author',
      isbn: 'old-isbn',
      externalWorkId: 'old-work-id',
      editionId: 'old-edition-id',
      series: 'Old series',
      seriesPosition: 2,
    });

    await service.updateClub('club-1', 'owner-1', {
      selectedWork: { title: 'New work', author: 'Author' },
    });

    expect(workRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New work',
        isbn: null,
        externalWorkId: null,
        editionId: null,
        series: null,
        seriesPosition: null,
      }),
    );
  });

  it('does not expose a private club to a non-member, including an instance administrator', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      visibility: BookClubVisibility.PRIVATE,
      status: 'active',
    });

    await expect(service.getClub('club-1', 'admin-user')).rejects.toThrow('Book club not found');
    expect(memberRepository.findOne).toHaveBeenCalledWith({ where: { clubId: 'club-1', userId: 'admin-user' } });
  });

  it('returns only the authenticated member role with a readable club', async () => {
    const club = {
      id: 'club-1',
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    };
    clubRepository.findOne.mockResolvedValue(club);
    memberRepository.findOne.mockResolvedValue({
      clubId: club.id,
      userId: 'moderator-1',
      role: BookClubRole.MODERATOR,
    });
    workRepository.findOne.mockResolvedValue({ id: 'work-1', clubId: club.id, title: 'Work', author: 'Author' });

    const result = await service.getClub(club.id, 'moderator-1');

    expect(result).toEqual(expect.objectContaining({ currentMembershipRole: BookClubRole.MODERATOR }));
    expect(memberRepository.findOne).toHaveBeenCalledTimes(1);
    expect(memberRepository.findOne).toHaveBeenCalledWith({ where: { clubId: club.id, userId: 'moderator-1' } });
  });

  it('reports no current role to a visible-club non-member without querying other memberships', async () => {
    const club = {
      id: 'club-1',
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    };
    clubRepository.findOne.mockResolvedValue(club);
    workRepository.findOne.mockResolvedValue({ id: 'work-1', clubId: club.id, title: 'Work', author: 'Author' });

    const result = await service.getClub(club.id, 'outsider-1');

    expect(result).toEqual(expect.objectContaining({ currentMembershipRole: null }));
    expect(memberRepository.findOne).toHaveBeenCalledTimes(1);
    expect(memberRepository.findOne).toHaveBeenCalledWith({ where: { clubId: club.id, userId: 'outsider-1' } });
  });

  it('returns not found before looking up a target member in a private club', async () => {
    const club = {
      id: 'private-club',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    };
    const privateMember = { clubId: 'private-club', userId: 'secret-user', role: BookClubRole.MEMBER };
    const targetUserId = 'secret-user';
    const attempts: Array<() => Promise<unknown>> = [
      () => service.joinClub(club.id, 'outsider'),
      () => service.getClub(club.id, 'outsider'),
      () => service.updateClub(club.id, 'outsider', { name: 'Changed' }),
      () => service.listMembers(club.id, 'outsider'),
      () => service.updateMemberRole(club.id, 'outsider', targetUserId, BookClubRole.MODERATOR),
      () => service.removeMember(club.id, 'outsider', targetUserId),
      () => service.transferOwnership(club.id, 'outsider', targetUserId),
      () => service.archiveClub(club.id, 'outsider'),
    ];

    for (const attempt of attempts) {
      jest.clearAllMocks();
      clubRepository.findOne.mockResolvedValue(club);
      memberRepository.findOne.mockImplementation((criteria: unknown) => {
        const userId = (criteria as { where: { userId: string } }).where.userId;
        return Promise.resolve(userId === targetUserId ? privateMember : undefined);
      });

      await expect(attempt()).rejects.toMatchObject({ status: 404 });
      expect(memberRepository.findOne).not.toHaveBeenCalledWith({ where: { clubId: club.id, userId: targetUserId } });
      expect(workRepository.findOne).not.toHaveBeenCalled();
    }
  });

  it('deletes a club only for its owner and relies on the club foreign-key cascades', async () => {
    const club = {
      id: 'private-club',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    };
    const deleteClub = (service as unknown as { deleteClub: (clubId: string, userId: string) => Promise<void> })
      .deleteClub;
    clubRepository.findOne.mockResolvedValue(club);
    memberRepository.findOne.mockResolvedValue(undefined);

    await expect(deleteClub.call(service, club.id, 'outsider')).rejects.toMatchObject({ status: 404 });
    expect(clubRepository.delete).not.toHaveBeenCalled();

    memberRepository.findOne.mockResolvedValue({ clubId: club.id, userId: 'member-1', role: BookClubRole.MEMBER });
    await expect(deleteClub.call(service, club.id, 'member-1')).rejects.toMatchObject({ status: 403 });
    expect(clubRepository.delete).not.toHaveBeenCalled();

    memberRepository.findOne.mockResolvedValue({ clubId: club.id, userId: 'owner-1', role: BookClubRole.OWNER });
    await deleteClub.call(service, club.id, 'owner-1');

    expect(clubRepository.delete).toHaveBeenCalledWith({ id: club.id });
    expect(memberRepository.delete).not.toHaveBeenCalled();
  });

  it('creates an owner membership and a logical selected work independent of book files', async () => {
    const club = await service.createClub('user-owner', {
      name: 'Evening Readers',
      visibility: BookClubVisibility.PRIVATE,
      selectedWork: {
        title: 'The Dispossessed',
        author: 'Ursula K. Le Guin',
        isbn: '9780061054884',
        externalWorkId: 'openlibrary-work-123',
        editionId: 'edition-456',
        series: 'Hainish Cycle',
        seriesPosition: 1,
      },
    });

    expect(club.ownerUserId).toBe('user-owner');
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: club.id, userId: 'user-owner', role: 'owner' }),
    );
    expect(workRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        clubId: club.id,
        title: 'The Dispossessed',
        author: 'Ursula K. Le Guin',
        isbn: '9780061054884',
        externalWorkId: 'openlibrary-work-123',
        editionId: 'edition-456',
        series: 'Hainish Cycle',
        seriesPosition: 1,
      }),
    );
    expect(workRepository.save.mock.calls[0][0]).not.toHaveProperty('bookId');
    expect(workRepository.save.mock.calls[0][0]).not.toHaveProperty('fileContentHash');
  });

  it('rejects confirming a match if the selected work changed before association persistence', async () => {
    const initialWork = {
      id: 'work-1',
      clubId: 'club-1',
      title: 'Original work',
      author: 'Author',
      externalWorkId: 'external-work-1',
    };
    const changedWork = { ...initialWork, title: 'Different work', externalWorkId: 'external-work-2' };
    const club = {
      id: 'club-1',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    };
    const member = { id: 'member-row-1', clubId: 'club-1', userId: 'member-1', role: BookClubRole.MEMBER };
    const book = {
      id: 'book-1',
      title: 'Original work',
      author: 'Author',
      externalWorkId: 'external-work-1',
      formats: [],
    };
    const bookService = {
      getMatchingBooks: jest.fn().mockResolvedValue([book]),
      getBookById: jest.fn().mockResolvedValue(book),
    };
    service = new BookClubsService(dataSource, bookService as never);
    clubRepository.findOne.mockResolvedValue(club);
    memberRepository.findOne.mockResolvedValue(member);
    workRepository.findOne
      .mockResolvedValueOnce(initialWork)
      .mockResolvedValueOnce(initialWork)
      .mockResolvedValueOnce(initialWork)
      .mockResolvedValueOnce(changedWork);

    await expect(service.confirmWorkMatch('club-1', 'work-1', 'member-1', 'book-1')).rejects.toMatchObject({
      status: 400,
    });
    expect(readingCopyRepository.upsert).not.toHaveBeenCalled();
  });
});
