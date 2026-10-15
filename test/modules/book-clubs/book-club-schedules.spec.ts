import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

describe('Book club schedules', () => {
  const clubId = '123e4567-e89b-42d3-a456-426614174001';
  const workId = '123e4567-e89b-42d3-a456-426614174002';
  const userId = '123e4567-e89b-42d3-a456-426614174003';
  const club = {
    id: clubId,
    ownerUserId: userId,
    visibility: BookClubVisibility.PRIVATE,
    status: BookClubStatus.ACTIVE,
    startDate: null,
    completionDate: null,
  };
  const work = { id: workId, clubId, title: 'The Dispossessed', author: 'Ursula K. Le Guin' };
  const membership = { id: 'member-1', clubId, userId, role: BookClubRole.OWNER };
  const clubRepository = { findOne: jest.fn(), save: jest.fn() };
  const memberRepository = { findOne: jest.fn() };
  const workRepository = { findOne: jest.fn() };
  const milestoneRepository = { find: jest.fn(), delete: jest.fn(), save: jest.fn() };
  class BookClubMilestoneEntity {}
  const repositories = new Map<unknown, unknown>([
    [BookClubEntity, clubRepository],
    [BookClubMemberEntity, memberRepository],
    [BookClubWorkEntity, workRepository],
    [BookClubMilestoneEntity, milestoneRepository],
  ]);
  const manager = {
    getRepository: (entity: unknown) =>
      (entity as { name?: string }).name === 'BookClubMilestoneEntity' ? milestoneRepository : repositories.get(entity),
  } as unknown as EntityManager;
  const dataSource = {
    transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => callback(manager),
  } as unknown as DataSource;
  let service: BookClubsService;

  beforeEach(() => {
    jest.clearAllMocks();
    clubRepository.findOne.mockResolvedValue({ ...club });
    clubRepository.save.mockImplementation((value: unknown) => Promise.resolve(value));
    memberRepository.findOne.mockResolvedValue({ ...membership });
    workRepository.findOne.mockResolvedValue({ ...work });
    milestoneRepository.find.mockResolvedValue([]);
    milestoneRepository.delete.mockResolvedValue(undefined);
    milestoneRepository.save.mockImplementation((values: unknown) => Promise.resolve(values));
    service = new BookClubsService(dataSource);
  });

  it.each([BookClubRole.OWNER, BookClubRole.MODERATOR])(
    'allows a %s to set dates and format-neutral named milestones',
    async (role) => {
      memberRepository.findOne.mockResolvedValue({ ...membership, role });
      const input = {
        startDate: '2026-11-01',
        completionDate: '2026-12-01',
        milestones: [
          { name: 'Part One', kind: 'part', position: 1 },
          { name: 'Chapter 4', kind: 'chapter', position: 2 },
          { name: 'Discussion checkpoint', kind: 'checkpoint', position: 3 },
        ],
      };

      await expect(scheduleService().updateSchedule(clubId, userId, input)).resolves.toEqual({
        clubId,
        startDate: input.startDate,
        completionDate: input.completionDate,
        milestones: input.milestones.map((milestone) => ({ id: expect.any(String), ...milestone })),
      });

      expect(clubRepository.findOne).toHaveBeenCalledWith({
        where: { id: clubId },
        lock: { mode: 'pessimistic_write' },
      });
      expect(clubRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ startDate: input.startDate, completionDate: input.completionDate }),
      );
      expect(milestoneRepository.delete).toHaveBeenCalledWith({ workId });
      const savedMilestones = milestoneRepository.save.mock.calls[0][0] as Array<{
        id: string;
        workId: string;
        name: string;
        kind: string;
        position: number;
      }>;
      expect(
        savedMilestones.map(({ workId: savedWorkId, name, kind, position }) => ({
          workId: savedWorkId,
          name,
          kind,
          position,
        })),
      ).toEqual(input.milestones.map((milestone) => ({ ...milestone, workId })));
      expect(savedMilestones.every(({ id }) => typeof id === 'string')).toBe(true);
    },
  );

  it('does not allow an ordinary member to change the schedule', async () => {
    memberRepository.findOne.mockResolvedValue({ ...membership, role: BookClubRole.MEMBER });

    await expect(
      scheduleService().updateSchedule(clubId, userId, {
        milestones: [{ name: 'Chapter', kind: 'chapter', position: 1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(clubRepository.save).not.toHaveBeenCalled();
    expect(milestoneRepository.save).not.toHaveBeenCalled();
  });

  it('conceals a private club schedule from non-members', async () => {
    memberRepository.findOne.mockResolvedValue(null);

    await expect(scheduleService().getSchedule(clubId, userId)).rejects.toBeInstanceOf(NotFoundException);
    expect(workRepository.findOne).not.toHaveBeenCalled();
    expect(milestoneRepository.find).not.toHaveBeenCalled();
  });

  it('rejects a completion date earlier than the start date without writing', async () => {
    await expect(
      scheduleService().updateSchedule(clubId, userId, { startDate: '2026-12-02', completionDate: '2026-12-01' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(clubRepository.save).not.toHaveBeenCalled();
  });

  it('rejects null milestones instead of treating them as an empty replacement', async () => {
    await expect(scheduleService().updateSchedule(clubId, userId, { milestones: null })).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(clubRepository.save).not.toHaveBeenCalled();
    expect(milestoneRepository.delete).not.toHaveBeenCalled();
  });

  function scheduleService(): {
    updateSchedule: (club: string, user: string, input: unknown) => Promise<unknown>;
    getSchedule: (club: string, user: string) => Promise<unknown>;
  } {
    return service as unknown as ReturnType<typeof scheduleService>;
  }
});
