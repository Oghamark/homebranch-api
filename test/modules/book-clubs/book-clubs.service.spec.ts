import { DataSource, EntityManager, getMetadataArgsStorage } from 'typeorm';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

describe('BookClubsService', () => {
  const clubRepository = {
    create: jest.fn((value: unknown): unknown => value),
    save: jest.fn((value: unknown): Promise<unknown> => Promise.resolve(value)),
    findOne: jest.fn<Promise<unknown>, [unknown]>(),
    find: jest.fn<Promise<unknown[]>, [unknown]>(),
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
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
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
    clubRepository.find.mockReset().mockResolvedValue([]);
    memberRepository.find.mockReset().mockResolvedValue([]);
    workRepository.find.mockReset().mockResolvedValue([]);
    service = new BookClubsService(dataSource);
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
    await expect(service.joinClub('private-club', 'reader-2')).rejects.toThrow(
      'Private clubs require owner-managed membership',
    );
  });

  it('lists instance-visible clubs and only the private clubs the caller belongs to', async () => {
    clubRepository.find.mockResolvedValue([
      { id: 'visible', visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ACTIVE },
      { id: 'private-member', visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
      { id: 'private-other', visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
      { id: 'archived', visibility: BookClubVisibility.INSTANCE_VISIBLE, status: BookClubStatus.ARCHIVED },
    ]);
    memberRepository.find.mockResolvedValue([{ clubId: 'private-member', userId: 'viewer' }]);
    workRepository.find.mockResolvedValue([
      { clubId: 'visible', title: 'Work A' },
      { clubId: 'private-member', title: 'Work B' },
    ]);

    const clubs = await service.listClubs('viewer');
    expect(clubs.map((club) => club.id)).toEqual(['visible', 'private-member']);
    expect(clubs[1].selectedWork.title).toBe('Work B');
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

  it('lets owners appoint a moderator while a moderator cannot grant another moderator role', async () => {
    clubRepository.findOne.mockResolvedValue({
      id: 'club-1',
      ownerUserId: 'owner-1',
      status: 'active',
      visibility: BookClubVisibility.PRIVATE,
    });
    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'owner-1', role: 'owner' })
      .mockResolvedValueOnce(undefined);

    await service.addMember('club-1', 'owner-1', { userId: 'moderator-2', role: BookClubRole.MODERATOR });
    expect(memberRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ clubId: 'club-1', userId: 'moderator-2', role: BookClubRole.MODERATOR }),
    );

    memberRepository.findOne
      .mockResolvedValueOnce({ clubId: 'club-1', userId: 'moderator-1', role: BookClubRole.MODERATOR })
      .mockResolvedValueOnce(undefined);
    await expect(
      service.addMember('club-1', 'moderator-1', { userId: 'moderator-3', role: BookClubRole.MODERATOR }),
    ).rejects.toThrow('Only the club owner can appoint moderators');
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

    memberRepository.findOne.mockResolvedValue({
      clubId: 'club-1',
      userId: 'moderator-1',
      role: BookClubRole.MODERATOR,
    });
    await expect(service.updateClub('club-1', 'moderator-1', { name: 'Unauthorized' })).rejects.toThrow(
      'Only the club owner can perform this action',
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

  it('creates an owner membership and a logical selected work independent of book files', async () => {
    const club = await service.createClub('user-owner', {
      name: 'Evening Readers',
      visibility: BookClubVisibility.PRIVATE,
      selectedWork: { title: 'The Dispossessed', author: 'Ursula K. Le Guin' },
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
      }),
    );
    expect(workRepository.save.mock.calls[0][0]).not.toHaveProperty('bookId');
    expect(workRepository.save.mock.calls[0][0]).not.toHaveProperty('fileContentHash');
  });
});
