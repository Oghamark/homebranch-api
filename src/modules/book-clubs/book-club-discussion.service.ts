import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubDiscussionThreadEntity } from 'src/modules/book-clubs/entities/book-club-discussion-thread.entity';
import { BookClubDiscussionReplyEntity } from 'src/modules/book-clubs/entities/book-club-discussion-reply.entity';
import { BookClubModerationAuditEntity } from 'src/modules/book-clubs/entities/book-club-moderation-audit.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';

export const ModerationAction = {
  LOCK: 'lock',
  UNLOCK: 'unlock',
  PIN: 'pin',
  UNPIN: 'unpin',
  HIDE: 'hide',
  RESTORE: 'restore',
  DELETE: 'delete',
} as const;
export type ModerationAction = (typeof ModerationAction)[keyof typeof ModerationAction];
type ThreadInput = { title: string; body: string; spoiler?: boolean; promptKind?: boolean };
type ReplyInput = { body: string; spoiler?: boolean };
type UpdateInput = { title?: string; body?: string; spoiler?: boolean };
type ModerationTarget = { hidden: boolean; deleted: boolean; locked?: boolean; pinned?: boolean };
type RecoveryTarget = {
  id: string;
  type: 'thread' | 'reply';
  hidden: boolean;
  deleted: boolean;
  createdAt: Date;
};

@Injectable()
export class BookClubDiscussionService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async listThreads(clubId: string, userId: string, revealSpoilers = false) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true, true);
      const rows = await manager
        .getRepository(BookClubDiscussionThreadEntity)
        .find({ where: { clubId }, order: { pinned: 'DESC', createdAt: 'DESC', id: 'DESC' } });
      return rows.filter((row) => !row.hidden && !row.deleted).map((row) => this.threadResponse(row, revealSpoilers));
    });
  }

  async getThread(clubId: string, threadId: string, userId: string, revealSpoilers = false) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true, true);
      const thread = await this.thread(manager, clubId, threadId);
      if (thread.hidden || thread.deleted) throw new NotFoundException('Discussion thread not found');
      return this.threadResponse(thread, revealSpoilers);
    });
  }

  async getReply(clubId: string, replyId: string, userId: string, revealSpoilers = false) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true, true);
      const reply = await this.reply(manager, clubId, replyId);
      const thread = await this.thread(manager, clubId, reply.threadId);
      if (reply.hidden || reply.deleted || thread.hidden || thread.deleted)
        throw new NotFoundException('Discussion reply not found');
      return this.replyResponse(reply, revealSpoilers);
    });
  }

  async createThread(clubId: string, userId: string, input: ThreadInput) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.member(manager, clubId, userId, true);
      if (input.promptKind && !this.isModerator(actor))
        throw new ForbiddenException('Club moderator role required for prompts');
      const repo = manager.getRepository(BookClubDiscussionThreadEntity);
      const thread = await repo.save(
        repo.create({
          clubId,
          authorUserId: userId,
          title: input.title,
          body: input.body,
          spoiler: !!input.spoiler,
          promptKind: !!input.promptKind,
          locked: false,
          pinned: false,
          hidden: false,
          deleted: false,
        }),
      );
      return this.threadResponse(thread, false);
    });
  }

  async editThread(clubId: string, threadId: string, userId: string, input: UpdateInput) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true);
      const thread = await this.thread(manager, clubId, threadId);
      this.assertAuthorEditable(thread, userId);
      if (input.title !== undefined) thread.title = input.title;
      if (input.body !== undefined) thread.body = input.body;
      if (input.spoiler !== undefined) thread.spoiler = input.spoiler;
      return this.threadResponse(await manager.getRepository(BookClubDiscussionThreadEntity).save(thread), false);
    });
  }

  async deleteOwnThread(clubId: string, threadId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true);
      const thread = await this.thread(manager, clubId, threadId);
      this.assertAuthorEditable(thread, userId);
      thread.deleted = true;
      await manager.getRepository(BookClubDiscussionThreadEntity).save(thread);
    });
  }

  async listReplies(clubId: string, threadId: string, userId: string, revealSpoilers = false) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true, true);
      const thread = await this.thread(manager, clubId, threadId);
      if (thread.hidden || thread.deleted) throw new NotFoundException('Discussion thread not found');
      const rows = await manager
        .getRepository(BookClubDiscussionReplyEntity)
        .find({ where: { clubId, threadId }, order: { createdAt: 'ASC', id: 'ASC' } });
      return rows.filter((row) => !row.hidden && !row.deleted).map((row) => this.replyResponse(row, revealSpoilers));
    });
  }

  async createReply(clubId: string, threadId: string, userId: string, input: ReplyInput) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true);
      const thread = await this.thread(manager, clubId, threadId);
      if (thread.locked || thread.hidden || thread.deleted)
        throw new ForbiddenException('Thread is not open for replies');
      const repo = manager.getRepository(BookClubDiscussionReplyEntity);
      const reply = await repo.save(
        repo.create({
          clubId,
          threadId,
          authorUserId: userId,
          body: input.body,
          spoiler: !!input.spoiler,
          hidden: false,
          deleted: false,
        }),
      );
      return this.replyResponse(reply, false);
    });
  }

  async editReply(clubId: string, replyId: string, userId: string, input: ReplyInput) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true);
      const reply = await this.reply(manager, clubId, replyId);
      const thread = await this.thread(manager, clubId, reply.threadId);
      this.assertAuthorEditable(reply, userId);
      if (thread.locked || thread.hidden || thread.deleted)
        throw new ForbiddenException('Thread is not open for edits');
      if (input.body !== undefined) reply.body = input.body;
      if (input.spoiler !== undefined) reply.spoiler = input.spoiler;
      return this.replyResponse(await manager.getRepository(BookClubDiscussionReplyEntity).save(reply), false);
    });
  }

  async deleteOwnReply(clubId: string, replyId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      await this.member(manager, clubId, userId, true);
      const reply = await this.reply(manager, clubId, replyId);
      this.assertAuthorEditable(reply, userId);
      reply.deleted = true;
      await manager.getRepository(BookClubDiscussionReplyEntity).save(reply);
    });
  }

  async moderateThread(clubId: string, threadId: string, userId: string, action: ModerationAction) {
    return this.moderate(clubId, userId, action, 'thread', threadId);
  }
  async moderateReply(
    clubId: string,
    replyId: string,
    userId: string,
    action: Exclude<ModerationAction, 'lock' | 'unlock' | 'pin' | 'unpin'>,
  ) {
    return this.moderate(clubId, userId, action, 'reply', replyId);
  }

  async getAudit(clubId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.member(manager, clubId, userId, true);
      if (actor.role !== BookClubRole.OWNER) throw new ForbiddenException('Club owner role required');
      return manager
        .getRepository(BookClubModerationAuditEntity)
        .find({ where: { clubId }, order: { createdAt: 'DESC', id: 'DESC' } });
    });
  }

  async listRecoveryTargets(clubId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const actor = await this.member(manager, clubId, userId, true);
      if (!this.isModerator(actor)) throw new ForbiddenException('Club moderator role required');
      const [threads, replies] = await Promise.all([
        manager.getRepository(BookClubDiscussionThreadEntity).find({
          select: { id: true, hidden: true, deleted: true, createdAt: true },
          where: { clubId },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
        manager.getRepository(BookClubDiscussionReplyEntity).find({
          select: { id: true, hidden: true, deleted: true, createdAt: true },
          where: { clubId },
          order: { createdAt: 'ASC', id: 'ASC' },
        }),
      ]);
      const targets: RecoveryTarget[] = [
        ...threads.map((target) => ({ ...target, type: 'thread' as const })),
        ...replies.map((target) => ({ ...target, type: 'reply' as const })),
      ];
      return targets
        .filter((target) => target.hidden || target.deleted)
        .sort(
          (left, right) =>
            left.createdAt.getTime() - right.createdAt.getTime() ||
            left.id.localeCompare(right.id) ||
            left.type.localeCompare(right.type),
        )
        .map(({ id, type, hidden, deleted }) => ({ id, type, hidden, deleted }));
    });
  }

  private async moderate(
    clubId: string,
    userId: string,
    action: ModerationAction,
    type: 'thread' | 'reply',
    id: string,
  ) {
    return this.dataSource.transaction(async (manager) => {
      if (!Object.values(ModerationAction).includes(action)) throw new BadRequestException('Invalid moderation action');
      const actor = await this.member(manager, clubId, userId, true);
      if (!this.isModerator(actor)) throw new ForbiddenException('Club moderator role required');
      const target: ModerationTarget =
        type === 'thread' ? await this.thread(manager, clubId, id) : await this.reply(manager, clubId, id);
      if (type === 'reply' && ['lock', 'unlock', 'pin', 'unpin'].includes(action))
        throw new BadRequestException('Action is not valid for replies');
      if (action === 'lock') target.locked = true;
      if (action === 'unlock') target.locked = false;
      if (action === 'pin') target.pinned = true;
      if (action === 'unpin') target.pinned = false;
      if (action === 'hide') target.hidden = true;
      if (action === 'restore') {
        target.hidden = false;
        target.deleted = false;
      }
      if (action === 'delete') target.deleted = true;
      await manager
        .getRepository(type === 'thread' ? BookClubDiscussionThreadEntity : BookClubDiscussionReplyEntity)
        .save(target);
      const auditRepo = manager.getRepository(BookClubModerationAuditEntity);
      await auditRepo.save(auditRepo.create({ clubId, actorUserId: userId, action, targetType: type, targetId: id }));
    });
  }

  private async member(manager: EntityManager, clubId: string, userId: string, lock = false, allowArchived = false) {
    const club = await manager
      .getRepository(BookClubEntity)
      .findOne({ where: { id: clubId }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!club || (!allowArchived && club.status !== BookClubStatus.ACTIVE))
      throw new NotFoundException('Book club not found');
    const member = await manager.getRepository(BookClubMemberEntity).findOne({ where: { clubId, userId } });
    if (!member) {
      if (club.visibility === BookClubVisibility.PRIVATE) throw new NotFoundException('Book club not found');
      throw new ForbiddenException('Book club membership required');
    }
    return member;
  }
  private async thread(manager: EntityManager, clubId: string, id: string) {
    const row = await manager.getRepository(BookClubDiscussionThreadEntity).findOne({ where: { id, clubId } });
    if (!row) throw new NotFoundException('Discussion thread not found');
    return row;
  }
  private async reply(manager: EntityManager, clubId: string, id: string) {
    const row = await manager.getRepository(BookClubDiscussionReplyEntity).findOne({ where: { id, clubId } });
    if (!row) throw new NotFoundException('Discussion reply not found');
    return row;
  }
  private isModerator(member: BookClubMemberEntity) {
    return member.role === BookClubRole.OWNER || member.role === BookClubRole.MODERATOR;
  }
  private assertAuthorEditable(
    row: { authorUserId: string; hidden: boolean; deleted: boolean; locked?: boolean },
    userId: string,
  ) {
    if (row.authorUserId !== userId || row.hidden || row.deleted || row.locked)
      throw new ForbiddenException('Only visible unlocked author content can be changed');
  }
  private threadResponse(row: BookClubDiscussionThreadEntity, reveal: boolean) {
    const { body, ...safe } = row;
    return row.spoiler && !reveal ? safe : { ...safe, body };
  }
  private replyResponse(row: BookClubDiscussionReplyEntity, reveal: boolean) {
    const { body, ...safe } = row;
    return row.spoiler && !reveal ? safe : { ...safe, body };
  }
}
