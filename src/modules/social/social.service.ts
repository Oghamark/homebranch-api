import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AccountDirectoryGateway } from 'src/modules/auth/account-directory.gateway';

type Account = { id: string; name: string };
type NamedAccount = { userId: string; name: string };
type RequestPreview = NamedAccount & { id: string; createdAt: Date; requesterId: string };
type InvitationPreview = {
  id: string;
  status: string;
  expiresAt: Date;
  userId?: string;
  name?: string;
  clubId?: string;
  clubName?: string;
  bookTitle?: string;
  bookAuthor?: string;
  inviterUserId?: string;
  inviterName?: string;
};
type NotificationRow = {
  id: string;
  kind: string;
  actorId: string;
  actorName: string;
  clubId: string | null;
  clubName: string | null;
  threadId: string | null;
  requestId: string | null;
  createdAt: Date;
  readAt: Date | null;
};
type Settings = { allowFriendRequests: boolean; clubInvites: 'anyone' | 'friends' | 'nobody' };
type Friendship = {
  id: string;
  low_id: string;
  high_id: string;
  requester_id: string;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
};
type Invitation = {
  id: string;
  club_id: string;
  inviter_id: string;
  invitee_id: string;
  status: string;
  expires_at: Date;
};
export const SOCIAL_LOCK = 1790000010;
const DAY = 86400000;

@Injectable()
export class SocialService {
  constructor(
    @InjectDataSource() private readonly db: DataSource,
    private readonly directory: AccountDirectoryGateway,
  ) {}

  // All social and club writers acquire this before club rows, then request rows.
  // A single instance-wide advisory lock favors correctness over write throughput.
  async lock(manager: EntityManager) {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [SOCIAL_LOCK]);
  }

  private async transaction<T>(operation: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.db.transaction(async (manager) => {
      await this.lock(manager);
      await this.reconcile(manager);
      return operation(manager);
    });
  }

  private async remember(manager: EntityManager, account: Account) {
    await manager.query(
      `INSERT INTO social_account(user_id,name) VALUES($1,$2)
       ON CONFLICT(user_id) DO UPDATE SET name=excluded.name`,
      [account.id, account.name],
    );
  }

  private async identities(actorId: string, targetId: string, credential: string) {
    if (actorId.toLowerCase() === targetId.toLowerCase()) throw new BadRequestException('Choose another account');
    return Promise.all([
      this.directory.requireAccount(actorId, credential),
      this.directory.requireAccount(targetId, credential),
    ]);
  }

  async throttle(userId: string, scope: string, maximum: number, seconds = 3600) {
    const row = await this.db.transaction(async (manager) => {
      await this.lock(manager);
      const [value] = await manager.query<Array<{ count: number; window_start: Date }>>(
        `INSERT INTO social_rate(user_id,scope,window_start,count) VALUES($1,$2,now(),1)
         ON CONFLICT(user_id,scope) DO UPDATE SET
         count=CASE WHEN social_rate.window_start <= now()-($3 * interval '1 second') THEN 1 ELSE social_rate.count+1 END,
         window_start=CASE WHEN social_rate.window_start <= now()-($3 * interval '1 second') THEN now() ELSE social_rate.window_start END
         RETURNING count,window_start`,
        [userId, scope, seconds],
      );
      return value;
    });
    if (row.count > maximum) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(row.window_start).getTime() + seconds * 1000 - Date.now()) / 1000),
      );
      throw new HttpException({ message: 'Too many requests. Try again later.', retryAfter }, 429);
    }
  }

  async search(userId: string, query: string, credential: string) {
    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 254)
      throw new BadRequestException('Search requires 2 to 254 characters');
    await this.throttle(userId, 'search', 30, 60);
    const rows = await this.directory.search(query.trim(), credential);
    return this.transaction(async (manager) => {
      const blocked: Array<{ id: string }> = await manager.query(
        `SELECT CASE WHEN user_id=$1 THEN blocked_id ELSE user_id END AS id
         FROM social_block WHERE user_id=$1 OR blocked_id=$1`,
        [userId],
      );
      const unavailable = new Set([userId, ...blocked.map((row) => row.id)]);
      return rows.filter((row) => !unavailable.has(row.id)).slice(0, 20);
    });
  }

  async settings(userId: string, input?: Partial<Settings>) {
    if (
      input &&
      ((input.allowFriendRequests !== undefined && typeof input.allowFriendRequests !== 'boolean') ||
        (input.clubInvites !== undefined && !['anyone', 'friends', 'nobody'].includes(input.clubInvites)))
    )
      throw new BadRequestException('Invalid social preferences');
    return this.transaction(async (manager) => {
      await manager.query(`INSERT INTO social_account(user_id,name) VALUES($1,'Someone') ON CONFLICT DO NOTHING`, [
        userId,
      ]);
      if (input) {
        await manager.query(
          `UPDATE social_account SET allow_friend_requests=COALESCE($2,allow_friend_requests),
           club_invites=COALESCE($3,club_invites) WHERE user_id=$1`,
          [userId, input.allowFriendRequests ?? null, input.clubInvites ?? null],
        );
        await this.reconcile(manager);
      }
      const [value] = await manager.query<Settings[]>(
        `SELECT allow_friend_requests AS "allowFriendRequests",club_invites AS "clubInvites" FROM social_account WHERE user_id=$1`,
        [userId],
      );
      return value;
    });
  }

  async friends(userId: string) {
    return this.transaction((manager) =>
      manager.query<NamedAccount[]>(
        `SELECT a.user_id AS "userId",a.name FROM social_friendship f
       JOIN social_account a ON a.user_id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END
       WHERE $1 IN(f.low_id,f.high_id) AND f.status='accepted' ORDER BY a.name,a.user_id`,
        [userId],
      ),
    );
  }

  async requests(userId: string) {
    return this.transaction(async (manager) => {
      const rows = await manager.query<RequestPreview[]>(
        `SELECT f.id,a.user_id AS "userId",a.name,f.created_at AS "createdAt",f.requester_id AS "requesterId"
         FROM social_friendship f JOIN social_account a ON
         a.user_id=CASE WHEN f.low_id=$1 THEN f.high_id ELSE f.low_id END
         WHERE $1 IN(f.low_id,f.high_id) AND f.status='pending' ORDER BY f.created_at DESC`,
        [userId],
      );
      return {
        incoming: rows
          .filter((row) => row.requesterId !== userId)
          .map(({ id, userId, name, createdAt }) => ({ id, userId, name, createdAt })),
        outgoing: rows
          .filter((row) => row.requesterId === userId)
          .map(({ id, userId, name, createdAt }) => ({ id, userId, name, createdAt })),
      };
    });
  }

  private async blocked(manager: EntityManager, first: string, second: string): Promise<boolean> {
    const rows = await manager.query<unknown[]>(
      `SELECT 1 FROM social_block WHERE (user_id=$1 AND blocked_id=$2) OR (user_id=$2 AND blocked_id=$1)`,
      [first, second],
    );
    return rows.length > 0;
  }

  private async eligible(manager: EntityManager, actorId: string, recipientId: string, club: boolean) {
    if (await this.blocked(manager, actorId, recipientId)) return false;
    const [row] = await manager.query<Array<{ allow_friend_requests: boolean; club_invites: string }>>(
      `SELECT allow_friend_requests,club_invites FROM social_account WHERE user_id=$1`,
      [recipientId],
    );
    if (!club) return row?.allow_friend_requests !== false;
    if (row?.club_invites === 'nobody') return false;
    if (row?.club_invites === 'friends') {
      const friends = await manager.query<unknown[]>(
        `SELECT 1 FROM social_friendship WHERE low_id=$1 AND high_id=$2 AND status='accepted'`,
        [actorId < recipientId ? actorId : recipientId, actorId < recipientId ? recipientId : actorId],
      );
      return friends.length > 0;
    }
    return true;
  }

  private cooldown(resolvedAt: Date | string | null) {
    if (resolvedAt && new Date(resolvedAt).getTime() + DAY > Date.now()) {
      throw new HttpException(
        {
          message: 'Please wait 24 hours before sending another request.',
          retryAfter: Math.ceil((new Date(resolvedAt).getTime() + DAY - Date.now()) / 1000),
        },
        429,
      );
    }
  }

  async sendFriend(userId: string, targetId: string, credential: string) {
    await this.throttle(userId, 'requests', 30);
    const accounts = await this.identities(userId, targetId, credential);
    [userId, targetId] = accounts.map((account) => account.id);
    return this.transaction(async (manager) => {
      for (const account of accounts) await this.remember(manager, account);
      if (!(await this.eligible(manager, userId, targetId, false)))
        throw new ForbiddenException('Account is unavailable for requests');
      const [low, high] = [userId, targetId].sort();
      const [old]: Friendship[] = await manager.query(
        `SELECT * FROM social_friendship WHERE low_id=$1 AND high_id=$2`,
        [low, high],
      );
      if (old?.status === 'pending')
        throw new ConflictException('A request already exists; incoming requests must be explicitly accepted');
      if (old?.status === 'accepted') throw new ConflictException('You are already friends');
      this.cooldown(old?.resolved_at ?? null);
      const id = randomUUID();
      await manager.query(
        `INSERT INTO social_friendship(low_id,high_id,id,requester_id,status) VALUES($1,$2,$3,$4,'pending')
         ON CONFLICT(low_id,high_id) DO UPDATE SET id=$3,requester_id=$4,status='pending',created_at=now(),resolved_at=NULL`,
        [low, high, id, userId],
      );
      await this.notify(manager, [targetId], userId, 'friend_request', id, { requestId: id });
      return { id, status: 'pending', userId: targetId, name: accounts[1].name };
    });
  }

  async friendAction(userId: string, id: string, action: 'accept' | 'decline' | 'cancel') {
    return this.transaction(async (manager) => {
      const [row]: Friendship[] = await manager.query(
        `SELECT * FROM social_friendship WHERE id=$1 AND $2 IN(low_id,high_id)`,
        [id, userId],
      );
      if (!row) throw new NotFoundException('Request not found');
      if ((action === 'cancel') !== (row.requester_id === userId))
        throw new ForbiddenException('This request action is not available');
      if (row.status !== 'pending') throw new ConflictException(`Request is ${row.status}`);
      const recipientId = row.requester_id === row.low_id ? row.high_id : row.low_id;
      if (!(await this.eligible(manager, row.requester_id, recipientId, false)))
        throw new ConflictException('Request is no longer available');
      const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
      await manager.query(`UPDATE social_friendship SET status=$2,resolved_at=now() WHERE id=$1`, [id, status]);
      if (action === 'accept')
        await this.notify(manager, [row.requester_id], userId, 'friend_accepted', `${id}:accepted`, { requestId: id });
      return { id, status };
    });
  }

  async removeFriend(userId: string, targetId: string) {
    targetId = targetId.toLowerCase();
    return this.transaction(async (manager) => {
      await manager.query(
        `UPDATE social_friendship SET status='removed',resolved_at=now()
         WHERE low_id=$1 AND high_id=$2 AND status='accepted'`,
        [userId < targetId ? userId : targetId, userId < targetId ? targetId : userId],
      );
      await this.reconcile(manager);
      return { success: true };
    });
  }

  async blocks(userId: string) {
    return this.transaction((manager) =>
      manager.query<NamedAccount[]>(
        `SELECT b.blocked_id AS "userId",COALESCE(a.name,'Someone') AS name FROM social_block b
       LEFT JOIN social_account a ON a.user_id=b.blocked_id WHERE b.user_id=$1 ORDER BY a.name,b.blocked_id`,
        [userId],
      ),
    );
  }

  async block(userId: string, targetId: string, credential: string) {
    const accounts = await this.identities(userId, targetId, credential);
    [userId, targetId] = accounts.map((account) => account.id);
    return this.transaction(async (manager) => {
      for (const account of accounts) await this.remember(manager, account);
      await manager.query(`INSERT INTO social_block(user_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [
        userId,
        targetId,
      ]);
      await manager.query(
        `UPDATE social_friendship SET status=CASE WHEN status='accepted' THEN 'removed' ELSE 'cancelled' END,resolved_at=now()
         WHERE low_id=$1 AND high_id=$2 AND status IN('pending','accepted')`,
        [...[userId, targetId].sort()],
      );
      await this.reconcile(manager);
      return { success: true };
    });
  }

  async unblock(userId: string, targetId: string) {
    targetId = targetId.toLowerCase();
    return this.transaction(async (manager) => {
      await manager.query(`DELETE FROM social_block WHERE user_id=$1 AND blocked_id=$2`, [userId, targetId]);
      return { success: true };
    });
  }

  async organizer(manager: EntityManager, clubId: string, userId: string) {
    const [row] = await manager.query<Array<{ id: string }>>(
      `SELECT c.id FROM book_club_entity c JOIN book_club_member_entity m ON m.club_id=c.id
       WHERE c.id=$1 AND c.status='active' AND m.user_id=$2 AND m.role IN('owner','moderator') FOR UPDATE OF c`,
      [clubId, userId],
    );
    if (!row) throw new ForbiddenException('Active club organizer permission required');
  }

  async invitations(userId: string, clubId?: string) {
    return this.transaction(async (manager) => {
      if (clubId) await this.organizer(manager, clubId, userId);
      return manager.query<InvitationPreview[]>(
        clubId
          ? `SELECT i.id,i.invitee_id AS "userId",a.name,i.expires_at AS "expiresAt",i.status
             FROM social_club_invitation i JOIN social_account a ON a.user_id=i.invitee_id
             WHERE i.club_id=$1 AND i.status='pending' ORDER BY i.created_at DESC`
          : `SELECT i.id,i.club_id AS "clubId",c.name AS "clubName",w.title AS "bookTitle",w.author AS "bookAuthor",
             i.inviter_id AS "inviterUserId",a.name AS "inviterName",i.expires_at AS "expiresAt",i.status
             FROM social_club_invitation i JOIN book_club_entity c ON c.id=i.club_id
             JOIN book_club_work_entity w ON w.club_id=c.id JOIN social_account a ON a.user_id=i.inviter_id
             WHERE i.invitee_id=$1 AND i.status='pending' ORDER BY i.created_at DESC`,
        [clubId ?? userId],
      );
    });
  }

  async sendInvitation(userId: string, clubId: string, targetId: string, credential: string) {
    await this.throttle(userId, 'requests', 30);
    const accounts = await this.identities(userId, targetId, credential);
    [userId, targetId] = accounts.map((account) => account.id);
    return this.transaction(async (manager) => {
      await this.organizer(manager, clubId, userId);
      for (const account of accounts) await this.remember(manager, account);
      if (!(await this.eligible(manager, userId, targetId, true)))
        throw new ForbiddenException('Account is unavailable for requests');
      const members = await manager.query<unknown[]>(
        `SELECT 1 FROM book_club_member_entity WHERE club_id=$1 AND user_id=$2`,
        [clubId, targetId],
      );
      if (members.length) throw new ConflictException('Account is already a member');
      const [old] = await manager.query<Array<{ status: string; resolved_at: Date | null }>>(
        `SELECT status,resolved_at FROM social_club_invitation WHERE club_id=$1 AND invitee_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [clubId, targetId],
      );
      if (old?.status === 'pending') throw new ConflictException('An invitation is already pending');
      if (old && ['cancelled', 'declined'].includes(old.status)) this.cooldown(old.resolved_at);
      const [row] = await manager.query<Array<{ id: string; expiresAt: Date; status: string }>>(
        `INSERT INTO social_club_invitation(club_id,inviter_id,invitee_id,status,expires_at)
         VALUES($1,$2,$3,'pending',now()+interval '30 days') RETURNING id,expires_at AS "expiresAt",status`,
        [clubId, userId, targetId],
      );
      await this.notify(manager, [targetId], userId, 'club_invitation', row.id, { clubId, requestId: row.id });
      return { ...row, userId: targetId, name: accounts[1].name };
    });
  }

  async invitationAction(userId: string, id: string, action: 'accept' | 'decline' | 'cancel', clubId?: string) {
    return this.transaction(async (manager) => {
      const [row]: Invitation[] = await manager.query(`SELECT * FROM social_club_invitation WHERE id=$1`, [id]);
      if (!row || (clubId && clubId !== row.club_id)) throw new NotFoundException('Invitation not found');
      if (action === 'cancel') await this.organizer(manager, row.club_id, userId);
      else if (row.invitee_id !== userId) throw new NotFoundException('Invitation not found');
      if (row.status !== 'pending') throw new ConflictException(`Invitation is ${row.status}`);
      const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'cancelled';
      if (action === 'accept') {
        await this.organizer(manager, row.club_id, row.inviter_id);
        if (
          !(await this.eligible(manager, row.inviter_id, userId, true)) ||
          new Date(row.expires_at).getTime() <= Date.now()
        )
          throw new ConflictException('Invitation is no longer available');
        await manager.query(
          `INSERT INTO book_club_member_entity(club_id,user_id,role) VALUES($1,$2,'member') ON CONFLICT(club_id,user_id) DO NOTHING`,
          [row.club_id, userId],
        );
        await this.notify(manager, [row.inviter_id], userId, 'club_invitation_accepted', `${id}:accepted`, {
          clubId: row.club_id,
          requestId: id,
        });
      }
      await manager.query(`UPDATE social_club_invitation SET status=$2,resolved_at=now() WHERE id=$1`, [id, status]);
      return { id, status, clubId: row.club_id };
    });
  }

  async activityPreference(userId: string, clubId: string, muted?: boolean) {
    if (muted !== undefined && typeof muted !== 'boolean') throw new BadRequestException('Muted must be a boolean');
    return this.transaction(async (manager) => {
      const members = await manager.query<unknown[]>(
        `SELECT 1 FROM book_club_member_entity WHERE club_id=$1 AND user_id=$2`,
        [clubId, userId],
      );
      if (!members.length) throw new NotFoundException('Club membership not found');
      if (muted !== undefined)
        await manager.query(
          `INSERT INTO social_club_mute(club_id,user_id,muted) VALUES($1,$2,$3)
         ON CONFLICT(club_id,user_id) DO UPDATE SET muted=$3`,
          [clubId, userId, muted],
        );
      const [row] = await manager.query<Array<{ muted: boolean }>>(
        `SELECT muted FROM social_club_mute WHERE club_id=$1 AND user_id=$2`,
        [clubId, userId],
      );
      return { muted: row?.muted ?? false };
    });
  }

  async reconcile(manager: EntityManager) {
    await manager.query(
      `UPDATE social_friendship f SET status='cancelled',resolved_at=now() WHERE status='pending' AND (
        EXISTS(SELECT 1 FROM social_block b WHERE (b.user_id=f.low_id AND b.blocked_id=f.high_id) OR (b.user_id=f.high_id AND b.blocked_id=f.low_id))
        OR EXISTS(SELECT 1 FROM social_account a WHERE a.user_id=CASE WHEN f.requester_id=f.low_id THEN f.high_id ELSE f.low_id END AND NOT a.allow_friend_requests))`,
    );
    await manager.query(
      `UPDATE social_club_invitation i SET status=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'cancelled' END,resolved_at=now()
       WHERE status='pending' AND (
         expires_at<=now() OR NOT EXISTS(SELECT 1 FROM book_club_entity c JOIN book_club_member_entity m ON m.club_id=c.id
          WHERE c.id=i.club_id AND c.status='active' AND m.user_id=i.inviter_id AND m.role IN('owner','moderator'))
         OR EXISTS(SELECT 1 FROM social_block b WHERE (b.user_id=i.inviter_id AND b.blocked_id=i.invitee_id) OR (b.user_id=i.invitee_id AND b.blocked_id=i.inviter_id))
         OR EXISTS(SELECT 1 FROM social_account a WHERE a.user_id=i.invitee_id AND (a.club_invites='nobody' OR (a.club_invites='friends' AND NOT EXISTS(
           SELECT 1 FROM social_friendship f WHERE f.low_id=LEAST(i.inviter_id,i.invitee_id) AND f.high_id=GREATEST(i.inviter_id,i.invitee_id) AND f.status='accepted')))))`,
    );
  }

  async cancelInvitations(manager: EntityManager, clubId: string, inviterId?: string) {
    await manager.query(
      `UPDATE social_club_invitation SET status='cancelled',resolved_at=now()
       WHERE club_id=$1 AND status='pending' AND ($2::varchar IS NULL OR inviter_id=$2)`,
      [clubId, inviterId ?? null],
    );
  }

  async resolveJoin(manager: EntityManager, clubId: string, userId: string) {
    await this.reconcile(manager);
    const rows = await manager.query<Array<{ id: string; inviter_id: string }>>(
      `WITH resolved AS (UPDATE social_club_invitation SET status='accepted',resolved_at=now()
       WHERE club_id=$1 AND invitee_id=$2 AND status='pending' RETURNING id,inviter_id) SELECT * FROM resolved`,
      [clubId, userId],
    );
    for (const row of rows)
      await this.notify(manager, [row.inviter_id], userId, 'club_invitation_accepted', `${row.id}:accepted`, {
        clubId,
        requestId: row.id,
      });
  }

  async notify(
    manager: EntityManager,
    recipients: string[],
    actorId: string,
    kind: string,
    eventKey: string,
    refs: { clubId?: string; threadId?: string; replyId?: string; requestId?: string } = {},
  ) {
    const ids = [...new Set(recipients)].filter((id) => id !== actorId);
    if (!ids.length) return;
    await manager.query(
      `INSERT INTO social_notification(recipient_id,actor_id,kind,event_key,club_id,thread_id,reply_id,request_id)
       SELECT recipient,$2,$3,$4,$5,$6,$7,$8 FROM unnest($1::varchar[]) recipient ON CONFLICT(recipient_id,event_key) DO NOTHING`,
      [
        ids,
        actorId,
        kind,
        eventKey,
        refs.clubId ?? null,
        refs.threadId ?? null,
        refs.replyId ?? null,
        refs.requestId ?? null,
      ],
    );
  }

  async activity(
    manager: EntityManager,
    clubId: string,
    actorId: string,
    kind: string,
    eventKey: string,
    threadId?: string,
    replyId?: string,
  ) {
    const members: Array<{ user_id: string }> = await manager.query(
      `SELECT m.user_id FROM book_club_member_entity m LEFT JOIN social_club_mute mute ON mute.club_id=m.club_id AND mute.user_id=m.user_id
       WHERE m.club_id=$1 AND NOT COALESCE(mute.muted,false) AND ($2::uuid IS NULL OR $3 <> 'club_reply'
       OR m.user_id IN(SELECT author_user_id FROM book_club_discussion_thread_entity WHERE id=$2
       UNION SELECT author_user_id FROM book_club_discussion_reply_entity WHERE thread_id=$2 AND NOT hidden AND NOT deleted))`,
      [clubId, threadId ?? null, kind],
    );
    await this.notify(
      manager,
      members.map((row) => row.user_id),
      actorId,
      kind,
      eventKey,
      { clubId, threadId, replyId },
    );
  }

  async scheduleSnapshot(manager: EntityManager, clubId: string, includeIds: boolean): Promise<string> {
    const rows = await manager.query<
      Array<{
        id: string | null;
        start_date: string | null;
        completion_date: string | null;
        name: string | null;
        kind: string | null;
        position: number | null;
      }>
    >(
      `SELECT c.start_date,c.completion_date,m.id,m.name,m.kind,m.position FROM book_club_entity c
       LEFT JOIN book_club_work_entity w ON w.club_id=c.id LEFT JOIN book_club_milestone_entity m ON m.work_id=w.id
       WHERE c.id=$1 ORDER BY m.position,m.id`,
      [clubId],
    );
    return JSON.stringify(rows.map(({ id, ...row }) => (includeIds ? { id, ...row } : row)));
  }

  private accessible = `
    n.recipient_id=$1 AND n.dismissed_at IS NULL AND
    (n.kind NOT IN('friend_request','friend_accepted') OR EXISTS(
      SELECT 1 FROM social_friendship f WHERE f.id=n.request_id AND
      ((n.kind='friend_request' AND f.status='pending') OR (n.kind='friend_accepted' AND f.status='accepted'))))
    AND (n.kind <> 'club_invitation' OR EXISTS(
      SELECT 1 FROM social_club_invitation i WHERE i.id=n.request_id AND i.invitee_id=$1 AND i.status='pending' AND i.expires_at>now()))
    AND (n.kind NOT IN('club_discussion','club_reply','club_reading_plan','club_invitation_accepted') OR EXISTS(
      SELECT 1 FROM book_club_entity c JOIN book_club_member_entity m ON m.club_id=c.id WHERE c.id=n.club_id AND m.user_id=$1))
    AND (n.thread_id IS NULL OR EXISTS(SELECT 1 FROM book_club_discussion_thread_entity t WHERE t.id=n.thread_id AND t.club_id=n.club_id AND NOT t.hidden AND NOT t.deleted))
    AND (n.reply_id IS NULL OR EXISTS(SELECT 1 FROM book_club_discussion_reply_entity r WHERE r.id=n.reply_id AND r.club_id=n.club_id AND NOT r.hidden AND NOT r.deleted))
  `;

  async notifications(userId: string, page = 1, limit = 20, credential?: string) {
    if (!Number.isInteger(page) || page < 1 || page > 100000 || !Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new BadRequestException('Page must be positive and limit between 1 and 100');
    const load = () =>
      this.transaction(async (manager) => {
        const [counts] = await manager.query<Array<{ total: number; unreadCount: number }>>(
          `SELECT count(*)::int AS total,count(*) FILTER(WHERE n.read_at IS NULL)::int AS "unreadCount"
         FROM social_notification n WHERE ${this.accessible}`,
          [userId],
        );
        const items = await manager.query<NotificationRow[]>(
          `SELECT n.id,n.kind,n.actor_id AS "actorId",COALESCE(a.name,'Someone') AS "actorName",n.club_id AS "clubId",c.name AS "clubName",
         n.thread_id AS "threadId",n.request_id AS "requestId",n.created_at AS "createdAt",n.read_at AS "readAt"
         FROM social_notification n LEFT JOIN social_account a ON a.user_id=n.actor_id
         LEFT JOIN book_club_entity c ON c.id=n.club_id WHERE ${this.accessible}
         ORDER BY n.created_at DESC,n.id DESC LIMIT $2 OFFSET $3`,
          [userId, limit, (page - 1) * limit],
        );
        return { items, ...counts, page, limit };
      });
    const result = await load();
    const names =
      credential && result.items.length
        ? await this.directory.displayNames([...new Set<string>(result.items.map((row) => row.actorId))], credential)
        : [];
    const namesById = new Map(names.map((account) => [account.id, account.name]));
    const current = credential ? await load() : result;
    return {
      ...current,
      items: current.items.map(({ actorId, ...row }) => ({
        ...row,
        actorName: credential ? (namesById.get(actorId) ?? 'Someone') : row.actorName,
      })),
    };
  }

  async notificationAction(userId: string, action: 'read' | 'dismiss' | 'read-all', id?: string) {
    return this.transaction(async (manager) => {
      if (action === 'read-all') {
        await manager.query(
          `UPDATE social_notification n SET read_at=COALESCE(read_at,now()) WHERE ${this.accessible}`,
          [userId],
        );
      } else {
        const rows = await manager.query<Array<{ id: string }>>(
          `WITH updated AS (UPDATE social_notification n SET ${action === 'read' ? 'read_at=COALESCE(read_at,now())' : 'dismissed_at=now()'}
           WHERE ${this.accessible} AND n.id=$2 RETURNING id) SELECT * FROM updated`,
          [userId, id],
        );
        if (!rows.length) throw new NotFoundException('Notification not found');
      }
      return { success: true };
    });
  }
}
