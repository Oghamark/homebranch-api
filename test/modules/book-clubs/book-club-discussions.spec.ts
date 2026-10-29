/* eslint-disable @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BookClubDiscussionService, ModerationAction } from 'src/modules/book-clubs/book-club-discussion.service';
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
  otherModerator: '00000000-0000-4000-8000-000000000015',
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
    { clubId: ids.otherClub, userId: ids.otherModerator, role: BookClubRole.MODERATOR },
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
    clubs,
    members,
    repositories,
    threads,
    replies,
    audits,
    service: new BookClubDiscussionService({
      transaction: async (fn) => fn({ getRepository: (entity) => repositories.get(entity) }),
    } as unknown as DataSource),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function concurrentReadFixture(changeMembership: () => RecordRow | null) {
  const membershipChecked = deferred();
  const membershipChanged = deferred();
  const payloadReturned = deferred();
  const events: string[] = [];
  let clubLocked = false;
  let membership: RecordRow | null = { clubId: ids.club, userId: ids.owner, role: BookClubRole.OWNER };
  const protectedRows = [
    { id: 'protected', clubId: ids.club, body: 'secret', hidden: true, deleted: false, createdAt: new Date(0) },
  ];
  const waitForProtectedRows = async () => {
    if (!clubLocked) await membershipChanged.promise;
    events.push('payload-returned');
    payloadReturned.resolve();
    return protectedRows;
  };
  const repositories = new Map<any, any>([
    [
      BookClubEntity,
      {
        findOne: jest.fn(async ({ lock }: { lock?: unknown }) => {
          clubLocked = !!lock;
          return { id: ids.club, visibility: BookClubVisibility.PRIVATE, status: BookClubStatus.ACTIVE };
        }),
      },
    ],
    [
      BookClubMemberEntity,
      {
        findOne: jest.fn(async () => {
          const observedMembership = membership;
          membershipChecked.resolve();
          return observedMembership;
        }),
      },
    ],
    [
      BookClubDiscussionThreadEntity,
      {
        find: jest.fn(waitForProtectedRows),
        findOne: jest.fn(async () => ({ id: 'thread-1', clubId: ids.club, hidden: false, deleted: false })),
      },
    ],
    [BookClubDiscussionReplyEntity, { find: jest.fn(waitForProtectedRows) }],
    [BookClubModerationAuditEntity, { find: jest.fn(waitForProtectedRows) }],
  ]);
  const service = new BookClubDiscussionService({
    transaction: async (fn) => fn({ getRepository: (entity) => repositories.get(entity) }),
  } as unknown as DataSource);
  return {
    service,
    events,
    async changeMembership() {
      await membershipChecked.promise;
      if (clubLocked) await payloadReturned.promise;
      membership = changeMembership();
      events.push('membership-changed');
      membershipChanged.resolve();
    },
  };
}

describe('BookClubDiscussionService', () => {
  it('reveals only the selected item and keeps default individual reads redacted under a club lock', async () => {
    const { service, repositories } = fixture();
    const thread = await service.createThread(ids.club, ids.member, {
      title: 'Ending',
      body: 'Thread secret',
      spoiler: true,
    });
    const reply = await service.createReply(ids.club, thread.id, ids.member, { body: 'Reply secret', spoiler: true });
    expect(await service.getThread(ids.club, thread.id, ids.member)).not.toHaveProperty('body');
    expect(await service.getReply(ids.club, reply.id, ids.member)).not.toHaveProperty('body');
    expect(await service.getThread(ids.club, thread.id, ids.member, true)).toHaveProperty('body', 'Thread secret');
    expect(await service.getReply(ids.club, reply.id, ids.member, true)).toHaveProperty('body', 'Reply secret');
    expect(repositories.get(BookClubEntity)!.findOne).toHaveBeenLastCalledWith({
      where: { id: ids.club },
      lock: { mode: 'pessimistic_write' },
    });
    expect(await service.listThreads(ids.club, ids.member)).toEqual([
      expect.not.objectContaining({ body: 'Thread secret' }),
    ]);
  });

  it.each(['hidden', 'deleted'])(
    'conceals individual %s content and replies below such parents even from moderators',
    async (state) => {
      const { service, threads, replies } = fixture();
      const thread = await service.createThread(ids.club, ids.member, {
        title: 'Title',
        body: 'Thread secret',
        spoiler: true,
      });
      const reply = await service.createReply(ids.club, thread.id, ids.member, { body: 'Reply secret', spoiler: true });
      replies[0][state] = true;
      await expect(service.getReply(ids.club, reply.id, ids.moderator, true)).rejects.toBeInstanceOf(NotFoundException);
      replies[0][state] = false;
      threads[0][state] = true;
      await expect(service.getThread(ids.club, thread.id, ids.moderator, true)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getReply(ids.club, reply.id, ids.moderator, true)).rejects.toBeInstanceOf(NotFoundException);
    },
  );

  it('permits archived member reads but never archived writes or non-member reveals', async () => {
    const { service, clubs } = fixture();
    const thread = await service.createThread(ids.club, ids.member, {
      title: 'Title',
      body: 'Thread secret',
      spoiler: true,
    });
    const reply = await service.createReply(ids.club, thread.id, ids.member, { body: 'Reply secret', spoiler: true });
    clubs[0].status = BookClubStatus.ARCHIVED;
    expect(await service.getThread(ids.club, thread.id, ids.member, true)).toHaveProperty('body', 'Thread secret');
    expect(await service.getReply(ids.club, reply.id, ids.member, true)).toHaveProperty('body', 'Reply secret');
    expect(await service.listThreads(ids.club, ids.member)).toHaveLength(1);
    expect(await service.listReplies(ids.club, thread.id, ids.member)).toHaveLength(1);
    await expect(service.createReply(ids.club, thread.id, ids.member, { body: 'Write' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.getThread(ids.club, thread.id, ids.outsider, true)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getReply(ids.otherClub, reply.id, ids.otherModerator, true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('denies visible-club non-members and revoked members individual spoiler reads', async () => {
    const { service, clubs, members } = fixture();
    const thread = await service.createThread(ids.club, ids.member, {
      title: 'Title',
      body: 'Thread secret',
      spoiler: true,
    });
    const reply = await service.createReply(ids.club, thread.id, ids.member, { body: 'Reply secret', spoiler: true });
    clubs[0].visibility = BookClubVisibility.INSTANCE_VISIBLE;
    members.splice(
      members.findIndex((member) => member.userId === ids.member),
      1,
    );
    await expect(service.getThread(ids.club, thread.id, ids.member, true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getReply(ids.club, reply.id, ids.outsider, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

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
  it('lists only recovery-safe hidden and deleted targets for moderators in deterministic order', async () => {
    const { service, threads, replies } = fixture();
    threads.push(
      {
        id: 'thread-deleted',
        clubId: ids.club,
        authorUserId: ids.member,
        title: 'private title',
        body: 'private thread body',
        spoiler: true,
        hidden: false,
        deleted: true,
        createdAt: new Date('2025-01-02T00:00:00.000Z'),
      },
      {
        id: 'thread-visible',
        clubId: ids.club,
        authorUserId: ids.member,
        title: 'visible title',
        body: 'visible body',
        spoiler: false,
        hidden: false,
        deleted: false,
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      },
    );
    replies.push({
      id: 'reply-hidden',
      clubId: ids.club,
      threadId: 'thread-visible',
      authorUserId: ids.member,
      body: 'private reply body',
      spoiler: true,
      hidden: true,
      deleted: false,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    await expect(service.listRecoveryTargets(ids.club, ids.moderator)).resolves.toEqual([
      { id: 'reply-hidden', type: 'reply', hidden: true, deleted: false },
      { id: 'thread-deleted', type: 'thread', hidden: false, deleted: true },
    ]);
  });
  it('rejects recovery target reads by members and does not disclose private clubs to non-members', async () => {
    const { service } = fixture();
    await expect(service.listRecoveryTargets(ids.club, ids.member)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.listRecoveryTargets(ids.club, ids.outsider)).rejects.toBeInstanceOf(NotFoundException);
  });
  it('rejects a moderator reading recovery targets from another private club', async () => {
    const { service, threads } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'private title',
      body: 'private thread body',
      spoiler: true,
      hidden: true,
      deleted: false,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    });
    await expect(service.listRecoveryTargets(ids.club, ids.otherModerator)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each([
    ['threads', (service: BookClubDiscussionService) => service.listThreads(ids.club, ids.owner)],
    ['replies', (service: BookClubDiscussionService) => service.listReplies(ids.club, 'thread-1', ids.owner)],
    ['moderation audit', (service: BookClubDiscussionService) => service.getAudit(ids.club, ids.owner)],
    ['recovery targets', (service: BookClubDiscussionService) => service.listRecoveryTargets(ids.club, ids.owner)],
  ])('serializes a %s read before concurrent membership revocation can commit', async (name, read) => {
    const revoked = jest.fn(() => null);
    const { service, events, changeMembership } = concurrentReadFixture(revoked);
    const readPromise = read(service);
    const revocationPromise = changeMembership();

    await Promise.all([readPromise, revocationPromise]);

    expect(revoked).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      ...Array.from({ length: name === 'recovery targets' ? 2 : 1 }, () => 'payload-returned'),
      'membership-changed',
    ]);
  });
  it('serializes the audit read before concurrent ownership transfer can commit', async () => {
    const transferred = jest.fn(() => ({
      clubId: ids.club,
      userId: ids.owner,
      role: BookClubRole.MEMBER,
    }));
    const { service, events, changeMembership } = concurrentReadFixture(transferred);
    const readPromise = service.getAudit(ids.club, ids.owner);
    const transferPromise = changeMembership();

    await Promise.all([readPromise, transferPromise]);

    expect(transferred).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['payload-returned', 'membership-changed']);
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
  it('preserves omitted transformed thread fields when editing a spoiler thread body', async () => {
    const { service, threads } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Original title',
      body: 'Original spoiler body',
      spoiler: true,
      locked: false,
      pinned: false,
      hidden: false,
      deleted: false,
    });

    const edited = await service.editThread(ids.club, 'thread-1', ids.member, {
      title: undefined,
      body: 'Updated spoiler body',
      spoiler: undefined,
    });

    expect(threads[0]).toMatchObject({ title: 'Original title', body: 'Updated spoiler body', spoiler: true });
    expect(edited).toMatchObject({ title: 'Original title', spoiler: true });
    expect(edited).not.toHaveProperty('body');
  });
  it('preserves an omitted transformed reply spoiler when editing its body', async () => {
    const { service, threads, replies } = fixture();
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
    replies.push({
      id: 'reply-1',
      clubId: ids.club,
      threadId: 'thread-1',
      authorUserId: ids.member,
      body: 'Original spoiler reply',
      spoiler: true,
      hidden: false,
      deleted: false,
    });

    const edited = await service.editReply(ids.club, 'reply-1', ids.member, {
      body: 'Updated spoiler reply',
      spoiler: undefined,
    });

    expect(replies[0]).toMatchObject({ body: 'Updated spoiler reply', spoiler: true });
    expect(edited).toMatchObject({ spoiler: true });
    expect(edited).not.toHaveProperty('body');
  });
  it.each(['hidden', 'deleted'] as const)('does not disclose replies below a %s thread', async (state) => {
    const { service, threads, replies } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Post',
      body: 'body',
      spoiler: false,
      locked: false,
      pinned: false,
      hidden: state === 'hidden',
      deleted: state === 'deleted',
    });
    replies.push({
      id: 'reply-1',
      clubId: ids.club,
      threadId: 'thread-1',
      authorUserId: ids.member,
      body: 'reply',
      spoiler: false,
      hidden: false,
      deleted: false,
    });
    await expect(service.listReplies(ids.club, 'thread-1', ids.member)).rejects.toBeInstanceOf(NotFoundException);
  });
  it.each(['hidden', 'deleted'] as const)('does not let an author edit a reply below a %s thread', async (state) => {
    const { service, threads, replies } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Post',
      body: 'body',
      spoiler: false,
      locked: false,
      pinned: false,
      hidden: state === 'hidden',
      deleted: state === 'deleted',
    });
    replies.push({
      id: 'reply-1',
      clubId: ids.club,
      threadId: 'thread-1',
      authorUserId: ids.member,
      body: 'reply',
      spoiler: false,
      hidden: false,
      deleted: false,
    });
    await expect(service.editReply(ids.club, 'reply-1', ids.member, { body: 'changed' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
  it.each(['hidden', 'deleted'] as const)('does not let an author delete a %s thread', async (state) => {
    const { service, threads } = fixture();
    threads.push({
      id: 'thread-1',
      clubId: ids.club,
      authorUserId: ids.member,
      title: 'Post',
      body: 'body',
      spoiler: false,
      locked: false,
      pinned: false,
      hidden: state === 'hidden',
      deleted: state === 'deleted',
    });
    await expect(service.deleteOwnThread(ids.club, 'thread-1', ids.member)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('rejects an invalid moderation action without creating an audit record', async () => {
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
    await expect(
      service.moderateThread(ids.club, 'thread-1', ids.moderator, 'invented' as unknown as ModerationAction),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(audits).toHaveLength(0);
  });
  it('allows moderators to hide a reply and records the action', async () => {
    const { service, threads, replies, audits } = fixture();
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
    replies.push({
      id: 'reply-1',
      clubId: ids.club,
      threadId: 'thread-1',
      authorUserId: ids.member,
      body: 'reply',
      spoiler: false,
      hidden: false,
      deleted: false,
    });
    await service.moderateReply(ids.club, 'reply-1', ids.moderator, 'hide');
    expect(replies[0]).toMatchObject({ hidden: true });
    expect(audits).toEqual([expect.objectContaining({ action: 'hide', targetType: 'reply', targetId: 'reply-1' })]);
  });
});
