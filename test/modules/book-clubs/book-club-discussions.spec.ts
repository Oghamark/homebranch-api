/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookClubDiscussionService } from 'src/modules/book-clubs/book-club-discussion.service';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubDiscussionThreadEntity } from 'src/modules/book-clubs/entities/book-club-discussion-thread.entity';
import { BookClubDiscussionReplyEntity } from 'src/modules/book-clubs/entities/book-club-discussion-reply.entity';
import { BookClubModerationAuditEntity } from 'src/modules/book-clubs/entities/book-club-moderation-audit.entity';

const ids = {
  club: '00000000-0000-4000-8000-000000000001',
  otherClub: '00000000-0000-4000-8000-000000000002',
  owner: '00000000-0000-4000-8000-000000000011',
  moderator: '00000000-0000-4000-8000-000000000012',
  member: '00000000-0000-4000-8000-000000000013',
  outsider: '00000000-0000-4000-8000-000000000014',
};
type RecordRow = Record<string, unknown>;
function repository(items: RecordRow[]) {
  return {
    create: jest.fn((value: RecordRow) => ({ id: `id-${items.length + 1}`, createdAt: new Date(0), ...value })),
    save: jest.fn(async (value: RecordRow) => {
      const index = items.findIndex((item) => item.id === value.id);
      if (index >= 0) items[index] = value;
      else items.push(value);
      return value;
    }),
    find: jest.fn(async ({ where }: { where?: RecordRow } = {}) =>
      items.filter((item) => Object.entries(where ?? {}).every(([key, value]) => item[key] === value)),
    ),
    findOne: jest.fn(
      async ({ where }: { where?: RecordRow } = {}) =>
        items.find((item) => Object.entries(where ?? {}).every(([key, value]) => item[key] === value)) ?? null,
    ),
  };
}
function fixture() {
  const clubs: RecordRow[] = [
    { id: ids.club, visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
    { id: ids.otherClub, visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE },
  ];
  const members: RecordRow[] = [
    { clubId: ids.club, userId: ids.owner, role: BookClubRole.OWNER },
    { clubId: ids.club, userId: ids.moderator, role: BookClubRole.MODERATOR },
    { clubId: ids.club, userId: ids.member, role: BookClubRole.MEMBER },
    { clubId: ids.otherClub, userId: ids.moderator, role: BookClubRole.MODERATOR },
  ];
  const threads: RecordRow[] = [];
  const replies: RecordRow[] = [];
  const audits: RecordRow[] = [];
  const repositories = new Map<any, ReturnType<typeof repository>>([
    [BookClubEntity, repository(clubs)],
    [BookClubMemberEntity, repository(members)],
    [BookClubDiscussionThreadEntity, repository(threads)],
    [BookClubDiscussionReplyEntity, repository(replies)],
    [BookClubModerationAuditEntity, repository(audits)],
  ]);
  return {
    threads,
    audits,
    service: new BookClubDiscussionService({
      transaction: async (fn) => fn({ getRepository: (entity) => repositories.get(entity) }),
    } as unknown as DataSource),
  };
}

describe('BookClubDiscussionService', () => {
  it('conceals spoiler bodies unless a member explicitly reveals them', async () => {
    const { service } = fixture();
    const created = await service.createThread(ids.club, ids.member, {
      title: 'Ending',
      body: 'The ending happens',
      spoiler: true,
    });
    expect(created).not.toHaveProperty('body');
    expect((await service.listThreads(ids.club, ids.member))[0]).not.toHaveProperty('body');
    expect(await service.listThreads(ids.club, ids.member, true)).toEqual([
      expect.objectContaining({ body: 'The ending happens' }),
    ]);
  });
  it('does not disclose private discussions to non-members', async () => {
    const { service } = fixture();
    await expect(service.listThreads(ids.club, ids.outsider)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('restricts moderation to the actor club and audits moderator actions for owner', async () => {
    const { service, threads, audits } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Post',
      body: 'body',
      spoiler: false,
      locked: false,
      pinned: false,
      hidden: false,
      deleted: false,
    });
    await expect(service.moderateThread(ids.otherClub, 'thread-1', ids.moderator, 'hide')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await service.moderateThread(ids.club, 'thread-1', ids.moderator, 'lock');
    await service.moderateThread(ids.club, 'thread-1', ids.moderator, 'hide');
    expect(threads[0]).toMatchObject({ locked: true, hidden: true });
    expect(await service.getAudit(ids.club, ids.owner)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actorUserId: ids.moderator, action: 'lock' }),
        expect.objectContaining({ action: 'hide' }),
      ]),
    );
    expect(audits).toHaveLength(2);
  });
  it('allows authors to edit only visible unlocked posts', async () => {
    const { service, threads } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Post',
      body: 'body',
      spoiler: false,
      locked: true,
      pinned: false,
      hidden: false,
      deleted: false,
    });
    await expect(service.editThread(ids.club, 'thread-1', ids.member, { body: 'changed' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
