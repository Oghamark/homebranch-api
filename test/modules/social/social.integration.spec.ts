import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { AccountDirectoryGateway } from 'src/modules/auth/account-directory.gateway';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubDiscussionService } from 'src/modules/book-clubs/book-club-discussion.service';
import { BookClubRole } from 'src/modules/book-clubs/book-club.types';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import {
  BookClubMilestoneEntity,
  BookClubMilestoneKind,
} from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubDiscussionThreadEntity } from 'src/modules/book-clubs/entities/book-club-discussion-thread.entity';
import { BookClubDiscussionReplyEntity } from 'src/modules/book-clubs/entities/book-club-discussion-reply.entity';
import { CreateSocial1790000000010 } from 'src/migrations/1790000000010-CreateSocial';
import { SocialService } from 'src/modules/social/social.service';

const url = process.env.SOCIAL_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('Social PostgreSQL lifecycle and concurrency', () => {
  const schema = `social_test_${randomUUID().replace(/-/g, '')}`;
  const owner = randomUUID();
  const recipient = randomUUID();
  const other = randomUUID();
  const fourth = randomUUID();
  const accounts = new Map<string, { id: string; name: string }>(
    [owner, recipient, other, fourth].map((id, index) => [id, { id, name: `Reader ${index}` }]),
  );
  const directory = {
    requireAccount: jest.fn((id: string) => {
      const account = accounts.get(id);
      if (!account) return Promise.reject(new Error('Account unavailable'));
      return Promise.resolve(account);
    }),
    search: jest.fn(() => Promise.resolve([...accounts.values()])),
    displayNames: jest.fn((ids: string[]) =>
      Promise.resolve(ids.flatMap((id) => (accounts.has(id) ? [accounts.get(id)!] : []))),
    ),
  } as unknown as AccountDirectoryGateway;
  let db: DataSource;
  let admin: DataSource;
  let social: SocialService;
  let clubs: BookClubsService;
  let discussions: BookClubDiscussionService;
  let clubId: string;

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      namingStrategy: new SnakeNamingStrategy(),
      entities: [
        BookClubEntity,
        BookClubMemberEntity,
        BookClubWorkEntity,
        BookClubMilestoneEntity,
        BookClubDiscussionThreadEntity,
        BookClubDiscussionReplyEntity,
      ],
      synchronize: true,
    }).initialize();
    const runner = db.createQueryRunner();
    try {
      await new CreateSocial1790000000010().up(runner);
    } finally {
      await runner.release();
    }
    social = new SocialService(db, directory);
    clubs = new BookClubsService(db, undefined, social);
    discussions = new BookClubDiscussionService(db, social);
  });

  afterAll(async () => {
    if (db?.isInitialized) {
      const runner = db.createQueryRunner();
      try {
        await new CreateSocial1790000000010().down(runner);
      } finally {
        await runner.release();
        await db.destroy();
      }
    }
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    await db.query(`TRUNCATE social_notification,social_club_invitation,social_club_mute,social_block,social_friendship,social_account,social_rate,
      book_club_discussion_reply_entity,book_club_discussion_thread_entity,book_club_milestone_entity,book_club_work_entity,book_club_member_entity,book_club_entity CASCADE`);
    const [club] = await db.query<Array<{ id: string }>>(
      `INSERT INTO book_club_entity(name,owner_user_id) VALUES('Private club',$1) RETURNING id`,
      [owner],
    );
    clubId = club.id;
    await db.query(`INSERT INTO book_club_member_entity(club_id,user_id,role) VALUES($1,$2,'owner')`, [clubId, owner]);
    await db.query(`INSERT INTO book_club_work_entity(club_id,title,author) VALUES($1,'Selected book','Book author')`, [
      clubId,
    ]);
  });

  async function invite(target = recipient, actor = owner) {
    return social.sendInvitation(actor, clubId, target, 'credential');
  }
  async function befriend(first = owner, second = recipient) {
    const request = await social.sendFriend(first, second, 'credential');
    await social.friendAction(second, request.id, 'accept');
    return request;
  }
  async function addMember(userId: string, role = 'member') {
    await db.query(`INSERT INTO book_club_member_entity(club_id,user_id,role) VALUES($1,$2,$3)`, [
      clubId,
      userId,
      role,
    ]);
  }

  it('requires consent and exposes only a minimal private preview until acceptance', async () => {
    const invitation = await invite();
    expect(await db.query(`SELECT 1 FROM book_club_member_entity WHERE user_id=$1`, [recipient])).toHaveLength(0);
    await expect(clubs.getClub(clubId, recipient)).rejects.toMatchObject({ status: 404 });
    await expect(clubs.listMembers(clubId, recipient)).rejects.toMatchObject({ status: 404 });
    expect(await social.invitations(recipient)).toEqual([
      expect.objectContaining({
        id: invitation.id,
        clubName: 'Private club',
        bookTitle: 'Selected book',
        bookAuthor: 'Book author',
        inviterName: 'Reader 0',
        status: 'pending',
      }),
    ]);
    await expect(social.invitationAction(other, invitation.id, 'accept')).rejects.toMatchObject({ status: 404 });
    await social.invitationAction(recipient, invitation.id, 'accept');
    expect(
      await db.query(`SELECT role,progress_sharing_enabled FROM book_club_member_entity WHERE user_id=$1`, [recipient]),
    ).toEqual([{ role: 'member', progress_sharing_enabled: false }]);
    expect(await social.invitations(recipient)).toEqual([]);
    await expect(social.invitationAction(recipient, invitation.id, 'accept')).rejects.toMatchObject({ status: 409 });
    expect((await social.notifications(owner)).items.map((row) => row.kind)).toContain('club_invitation_accepted');
  });

  it('serializes duplicate and reverse sends, requiring explicit reverse acceptance', async () => {
    const outcomes = await Promise.allSettled([
      social.sendFriend(owner, recipient, 'credential'),
      social.sendFriend(recipient, owner, 'credential'),
    ]);
    expect(outcomes.filter((value) => value.status === 'fulfilled')).toHaveLength(1);
    const [pair] = await db.query<Array<{ id: string; status: string; requester_id: string }>>(
      `SELECT * FROM social_friendship`,
    );
    expect(pair.status).toBe('pending');
    expect(await db.query(`SELECT * FROM social_notification`)).toHaveLength(1);
    const target = pair.requester_id === owner ? recipient : owner;
    await social.friendAction(target, pair.id, 'accept');
    expect(await social.friends(owner)).toEqual([{ userId: recipient, name: 'Reader 1' }]);
  });

  it('keeps old generation links stale and enforces the decline cooldown', async () => {
    const first = await social.sendFriend(owner, recipient, 'credential');
    await social.friendAction(recipient, first.id, 'decline');
    await expect(social.sendFriend(recipient, owner, 'credential')).rejects.toMatchObject({ status: 429 });
    await db.query(`UPDATE social_friendship SET resolved_at=now()-interval '24 hours'`);
    const second = await social.sendFriend(recipient, owner, 'credential');
    expect(second.id).not.toBe(first.id);
    await expect(social.friendAction(recipient, first.id, 'accept')).rejects.toMatchObject({ status: 404 });
    expect((await social.notifications(recipient)).items).toHaveLength(0);
  });

  it('supports cancel, protects request ownership, and cannot bypass cooldown by removing a friend', async () => {
    const request = await social.sendFriend(owner, recipient, 'credential');
    await expect(social.friendAction(owner, request.id, 'accept')).rejects.toMatchObject({ status: 403 });
    await expect(social.friendAction(recipient, request.id, 'cancel')).rejects.toMatchObject({ status: 403 });
    await social.friendAction(owner, request.id, 'cancel');
    await expect(social.sendFriend(owner, recipient, 'credential')).rejects.toMatchObject({ status: 429 });
    await db.query(`UPDATE social_friendship SET resolved_at=now()-interval '24 hours'`);
    await befriend();
    await social.removeFriend(owner, recipient.toUpperCase());
    await expect(social.sendFriend(owner, recipient, 'credential')).rejects.toMatchObject({ status: 429 });
  });

  it('expires invitations at 30 days without a worker and allows a fresh generation', async () => {
    const first = await invite();
    const [{ duration }] = await db.query<Array<{ duration: number }>>(
      `SELECT extract(epoch FROM expires_at-created_at)::int AS duration FROM social_club_invitation`,
    );
    expect(duration).toBe(30 * 86400);
    await db.query(`UPDATE social_club_invitation SET created_at=now()-interval '31 days',expires_at=now()`);
    expect(await social.invitations(recipient)).toEqual([]);
    await expect(social.invitationAction(recipient, first.id, 'accept')).rejects.toMatchObject({ status: 409 });
    const second = await invite();
    expect(second.id).not.toBe(first.id);
  });

  it('enforces invitation cancellation cooldown and cannot re-open terminal generations', async () => {
    const first = await invite();
    await social.invitationAction(owner, first.id, 'cancel', clubId);
    await expect(invite()).rejects.toMatchObject({ status: 429 });
    await db.query(`UPDATE social_club_invitation SET resolved_at=now()-interval '24 hours'`);
    await invite();
    await expect(social.invitationAction(recipient, first.id, 'accept')).rejects.toMatchObject({ status: 409 });
  });

  it('serializes invitation duplicates and public join/accept without duplicate memberships', async () => {
    const attempts = await Promise.allSettled([invite(), invite()]);
    expect(attempts.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    const [invitation] = await db.query<Array<{ id: string }>>(`SELECT id FROM social_club_invitation`);
    await db.query(`UPDATE book_club_entity SET visibility='instance_visible' WHERE id=$1`, [clubId]);
    await Promise.allSettled([
      social.invitationAction(recipient, invitation.id, 'accept'),
      clubs.joinClub(clubId, recipient),
    ]);
    expect(
      await db.query(`SELECT 1 FROM book_club_member_entity WHERE club_id=$1 AND user_id=$2`, [clubId, recipient]),
    ).toHaveLength(1);
    expect(await social.invitations(recipient)).toEqual([]);
  });

  it.each(['archive', 'demote', 'remove', 'transfer'] as const)(
    'invalidates invitations after inviter %s',
    async (action) => {
      let actor = owner;
      if (action === 'demote' || action === 'remove') {
        await addMember(other, 'moderator');
        actor = other;
      }
      const invitation = await invite(recipient, actor);
      if (action === 'archive') await clubs.archiveClub(clubId, owner);
      if (action === 'demote') await clubs.updateMemberRole(clubId, owner, other, BookClubRole.MEMBER);
      if (action === 'remove') await clubs.removeMember(clubId, owner, other);
      if (action === 'transfer') {
        await addMember(other);
        await clubs.transferOwnership(clubId, owner, other);
      }
      await expect(social.invitationAction(recipient, invitation.id, 'accept')).rejects.toMatchObject({ status: 409 });
      expect(await social.invitations(recipient)).toHaveLength(0);
    },
  );

  it('cancels affected requests on policy changes without removing memberships or friends', async () => {
    const request = await social.sendFriend(owner, recipient, 'credential');
    await social.settings(recipient, { allowFriendRequests: false });
    await expect(social.friendAction(recipient, request.id, 'accept')).rejects.toMatchObject({ status: 409 });
    await social.settings(recipient, { allowFriendRequests: true });
    await db.query(`UPDATE social_friendship SET resolved_at=now()-interval '24 hours'`);
    await befriend();
    const invitation = await invite();
    await social.settings(recipient, { clubInvites: 'friends' });
    expect(await social.invitations(recipient)).toHaveLength(1);
    await social.removeFriend(owner, recipient);
    await expect(social.invitationAction(recipient, invitation.id, 'accept')).rejects.toMatchObject({ status: 409 });
    await expect(invite()).rejects.toMatchObject({ status: 403 });
  });

  it('blocks both directions, ends friendships, and does not remove shared membership', async () => {
    await befriend();
    await addMember(recipient);
    await invite(other);
    await social.block(owner, recipient, 'credential');
    expect(await social.friends(recipient)).toEqual([]);
    expect(await clubs.listMembers(clubId, recipient)).toHaveLength(2);
    await expect(social.sendFriend(recipient, owner, 'credential')).rejects.toMatchObject({ status: 403 });
    await expect(social.sendFriend(owner, recipient, 'credential')).rejects.toMatchObject({ status: 403 });
    await social.unblock(owner, recipient.toUpperCase());
    expect(await social.friends(owner)).toEqual([]);
  });

  it('makes block/accept and archive/accept races preserve final policy invariants', async () => {
    const request = await social.sendFriend(owner, recipient, 'credential');
    await Promise.allSettled([
      social.friendAction(recipient, request.id, 'accept'),
      social.block(owner, recipient, 'credential'),
    ]);
    expect(await social.friends(owner)).toEqual([]);
    await social.unblock(owner, recipient);
    const invitation = await invite();
    await Promise.allSettled([
      social.invitationAction(recipient, invitation.id, 'accept'),
      clubs.archiveClub(clubId, owner),
    ]);
    expect(await social.invitations(recipient)).toHaveLength(0);
    expect(await db.query(`SELECT 1 FROM social_club_invitation WHERE status='pending'`)).toHaveLength(0);
  });

  it('filters inbox/count/read actions consistently after membership or content access is revoked', async () => {
    await addMember(recipient);
    const thread = await discussions.createThread(clubId, owner, { title: 'Spoiler title', body: 'Secret body' });
    const inbox = await social.notifications(recipient);
    expect(inbox.unreadCount).toBe(1);
    expect(JSON.stringify(inbox)).not.toMatch(/Spoiler title|Secret body/);
    const notification = inbox.items[0];
    await social.notificationAction(recipient, 'read', notification.id);
    expect((await social.notifications(recipient)).unreadCount).toBe(0);
    await db.query(`UPDATE book_club_discussion_thread_entity SET hidden=true WHERE id=$1`, [thread.id]);
    expect(await social.notifications(recipient)).toMatchObject({ total: 0, unreadCount: 0, items: [] });
    await expect(social.notificationAction(recipient, 'read', notification.id)).rejects.toMatchObject({ status: 404 });
    await db.query(`UPDATE book_club_discussion_thread_entity SET hidden=false WHERE id=$1`, [thread.id]);
    await clubs.removeMember(clubId, owner, recipient);
    expect((await social.notifications(recipient)).items).toHaveLength(0);
  });

  it('deduplicates reply participants, excludes actors, and honors per-club mute without hiding requests', async () => {
    await addMember(recipient);
    await addMember(other);
    await addMember(fourth);
    const thread = await discussions.createThread(clubId, owner, { title: 'Topic', body: 'Body' });
    await discussions.createReply(clubId, thread.id, recipient, { body: 'One' });
    await discussions.createReply(clubId, thread.id, recipient, { body: 'Two' });
    await social.activityPreference(owner, clubId, true);
    await discussions.createReply(clubId, thread.id, other, { body: 'Three' });
    const replies = await db.query<Array<{ recipient_id: string }>>(
      `SELECT recipient_id FROM social_notification WHERE kind='club_reply' AND actor_id=$1`,
      [other],
    );
    expect(replies).toEqual([{ recipient_id: recipient }]);
    const request = await social.sendFriend(other, owner, 'credential');
    expect((await social.notifications(owner)).items.map((row) => row.requestId)).toContain(request.id);
  });

  it('notifies material reading-plan changes but suppresses no-op schedule saves', async () => {
    await addMember(recipient);
    await clubs.patchSchedule(clubId, owner, { startDate: '2026-11-01' });
    await clubs.patchSchedule(clubId, owner, { startDate: '2026-11-01' });
    await clubs.patchSchedule(clubId, owner, {});
    expect(await db.query(`SELECT 1 FROM social_notification WHERE kind='club_reading_plan'`)).toHaveLength(1);
    const schedule = await clubs.patchSchedule(clubId, owner, {
      milestones: [{ name: 'Part one', kind: BookClubMilestoneKind.CHAPTER, position: 1 }],
    });
    await clubs.patchSchedule(clubId, owner, { milestones: schedule.milestones });
    expect(await db.query(`SELECT 1 FROM social_notification WHERE kind='club_reading_plan'`)).toHaveLength(2);
  });

  it('rolls back notifications together with a failing underlying transaction', async () => {
    await expect(
      db.transaction(async (manager) => {
        await social.lock(manager);
        await social.notify(manager, [recipient], owner, 'friend_request', randomUUID(), { requestId: randomUUID() });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await db.query(`SELECT 1 FROM social_notification`)).toHaveLength(0);
  });

  it('rolls back the underlying friend request when its notification cannot persist', async () => {
    await db.query(
      `ALTER TABLE social_notification ADD CONSTRAINT test_fail_notification CHECK(kind <> 'friend_request')`,
    );
    try {
      await expect(social.sendFriend(owner, recipient, 'credential')).rejects.toThrow();
      expect(await db.query(`SELECT 1 FROM social_friendship`)).toHaveLength(0);
      expect(await db.query(`SELECT 1 FROM social_notification`)).toHaveLength(0);
    } finally {
      await db.query(`ALTER TABLE social_notification DROP CONSTRAINT test_fail_notification`);
    }
  });

  it('resolves actor names outside locks and rechecks club access after the remote lookup', async () => {
    await addMember(recipient);
    await discussions.createThread(clubId, owner, { title: 'Topic', body: 'Private text' });
    const first = await social.notifications(recipient, 1, 20, 'credential');
    expect(first.items[0].actorName).toBe('Reader 0');
    expect(first.items[0]).not.toHaveProperty('actorId');
    jest.spyOn(directory, 'displayNames').mockImplementationOnce(async () => {
      await clubs.removeMember(clubId, owner, recipient);
      return [accounts.get(owner)!];
    });
    expect(await social.notifications(recipient, 1, 20, 'credential')).toMatchObject({
      items: [],
      total: 0,
      unreadCount: 0,
    });
  });

  it('serializes preference/accept and invitation cancel/accept races', async () => {
    const request = await social.sendFriend(owner, recipient, 'credential');
    await Promise.allSettled([
      social.friendAction(recipient, request.id, 'accept'),
      social.settings(recipient, { allowFriendRequests: false }),
    ]);
    expect((await social.requests(recipient)).incoming).toHaveLength(0);
    const invitation = await invite();
    const outcomes = await Promise.allSettled([
      social.invitationAction(recipient, invitation.id, 'accept'),
      social.invitationAction(owner, invitation.id, 'cancel', clubId),
    ]);
    expect(outcomes.filter((row) => row.status === 'fulfilled')).toHaveLength(1);
    expect(await db.query(`SELECT 1 FROM social_club_invitation WHERE status='pending'`)).toHaveLength(0);
    expect(
      (await db.query<unknown[]>(`SELECT 1 FROM book_club_member_entity WHERE user_id=$1`, [recipient])).length,
    ).toBeLessThanOrEqual(1);
  });

  it('read/dismiss does not decide requests and notification ownership cannot be forged', async () => {
    const request = await social.sendFriend(owner, recipient, 'credential');
    const inbox = await social.notifications(recipient);
    await expect(social.notificationAction(other, 'read', inbox.items[0].id)).rejects.toMatchObject({ status: 404 });
    await social.notificationAction(recipient, 'read-all');
    expect((await social.notifications(recipient)).unreadCount).toBe(0);
    await social.notificationAction(recipient, 'dismiss', inbox.items[0].id);
    expect((await social.notifications(recipient)).items).toHaveLength(0);
    expect((await social.requests(recipient)).incoming[0].id).toBe(request.id);
  });

  it('bounds/throttles discovery, filters blocks, and rate limits outgoing requests durably', async () => {
    await expect(social.search(owner, '', 'credential')).rejects.toMatchObject({ status: 400 });
    await social.block(owner, recipient, 'credential');
    expect((await social.search(owner, 'Reader', 'credential')).map((row) => row.id)).not.toContain(recipient);
    for (let index = 0; index < 30; index++) await social.throttle(other, 'search', 30, 60);
    await expect(social.throttle(other, 'search', 30, 60)).rejects.toMatchObject({ status: 429 });
    for (let index = 0; index < 30; index++) await social.throttle(other, 'requests', 30);
    await expect(social.sendFriend(other, recipient, 'credential')).rejects.toMatchObject({ status: 429 });
    await expect(social.notifications(owner, 1, 101)).rejects.toMatchObject({ status: 400 });
  });
});
