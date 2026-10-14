import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In } from 'typeorm';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';

export interface CreateBookClubInput {
  name: string;
  visibility: BookClubVisibility;
  description?: string;
  selectedWork: { title: string; author: string };
}

export interface AddBookClubMemberInput {
  userId: string;
  role?: BookClubRole;
}

export interface UpdateBookClubInput {
  name?: string;
  description?: string | null;
  visibility?: BookClubVisibility;
  selectedWork?: { title: string; author: string };
}

@Injectable()
export class BookClubsService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async joinClub(clubId: string, userId: string): Promise<BookClubMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId);
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be joined');
      }
      if (club.visibility !== BookClubVisibility.INSTANCE_VISIBLE) {
        throw new ForbiddenException('Private clubs require owner-managed membership');
      }
      if (actor) throw new ConflictException('User is already a member of this book club');
      return memberRepository.save(memberRepository.create({ clubId, userId, role: BookClubRole.MEMBER }));
    });
  }

  async listClubs(userId: string): Promise<Array<BookClubEntity & { selectedWork: BookClubWorkEntity }>> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const workRepository = manager.getRepository(BookClubWorkEntity);
      const [clubs, memberships] = await Promise.all([
        clubRepository.find({ where: { status: BookClubStatus.ACTIVE }, order: { createdAt: 'DESC' } }),
        memberRepository.find({ where: { userId } }),
      ]);
      const memberClubIds = new Set(memberships.map((membership) => membership.clubId));
      const visibleClubs = clubs.filter(
        (club) => club.visibility === BookClubVisibility.INSTANCE_VISIBLE || memberClubIds.has(club.id),
      );
      if (visibleClubs.length === 0) return [];

      const works = await workRepository.find({ where: { clubId: In(visibleClubs.map((club) => club.id)) } });
      const worksByClub = new Map(works.map((work) => [work.clubId, work]));
      return visibleClubs
        .filter((club) => worksByClub.has(club.id))
        .map((club) => Object.assign(club, { selectedWork: worksByClub.get(club.id)! }));
    });
  }

  async archiveClub(clubId: string, userId: string): Promise<BookClubEntity> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId);
      if (club.ownerUserId !== userId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      club.status = BookClubStatus.ARCHIVED;
      return clubRepository.save(club);
    });
  }

  async updateMemberRole(
    clubId: string,
    actorUserId: string,
    targetUserId: string,
    role: BookClubRole,
  ): Promise<BookClubMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId, true);
      if (role === BookClubRole.OWNER) throw new BadRequestException('Use ownership transfer to change the owner');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      if (club.ownerUserId !== actorUserId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      const member = await memberRepository.findOne({ where: { clubId, userId: targetUserId } });
      if (!member || member.role === BookClubRole.OWNER) throw new NotFoundException('Book club member not found');
      member.role = role;
      return memberRepository.save(member);
    });
  }

  async removeMember(clubId: string, actorUserId: string, targetUserId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId, true);
      const isSelfLeave = actorUserId === targetUserId;
      if (!isSelfLeave && actor?.role !== BookClubRole.OWNER && actor?.role !== BookClubRole.MODERATOR) {
        throw new ForbiddenException('Club membership management permission required');
      }
      if (!isSelfLeave && club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }

      const target = isSelfLeave ? actor : await memberRepository.findOne({ where: { clubId, userId: targetUserId } });
      if (!target) throw new NotFoundException('Book club member not found');
      if (target.role === BookClubRole.OWNER || targetUserId === club.ownerUserId) {
        throw new ForbiddenException('Transfer ownership before removing the owner');
      }
      if (actor?.role === BookClubRole.MODERATOR && !isSelfLeave && target.role !== BookClubRole.MEMBER) {
        throw new ForbiddenException('Moderators can only remove members');
      }
      await memberRepository.delete({ clubId, userId: targetUserId });
    });
  }

  async transferOwnership(clubId: string, actorUserId: string, newOwnerUserId: string): Promise<BookClubEntity> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId, true);
      if (actorUserId === newOwnerUserId) throw new BadRequestException('New owner must be another club member');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      if (club.ownerUserId !== actorUserId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      const nextOwner = await memberRepository.findOne({ where: { clubId, userId: newOwnerUserId } });
      if (!nextOwner) throw new NotFoundException('New owner must already be a club member');
      if (nextOwner.role === BookClubRole.OWNER) throw new ConflictException('Book club already has this owner');

      actor.role = BookClubRole.MEMBER;
      nextOwner.role = BookClubRole.OWNER;
      club.ownerUserId = newOwnerUserId;
      await memberRepository.save(actor);
      await memberRepository.save(nextOwner);
      return clubRepository.save(club);
    });
  }

  async addMember(clubId: string, actorUserId: string, input: AddBookClubMemberInput): Promise<BookClubMemberEntity> {
    return this.dataSource.transaction(async (manager) => {
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId);
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      if (!actor || (actor.role !== BookClubRole.OWNER && actor.role !== BookClubRole.MODERATOR)) {
        throw new ForbiddenException('Club membership management permission required');
      }

      const role = input.role ?? BookClubRole.MEMBER;
      if (role === BookClubRole.OWNER) throw new ForbiddenException('Use ownership transfer to change the owner');
      if (role === BookClubRole.MODERATOR && actor.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can appoint moderators');
      }
      if (await memberRepository.findOne({ where: { clubId, userId: input.userId } })) {
        throw new ConflictException('User is already a member of this book club');
      }

      return memberRepository.save(memberRepository.create({ clubId, userId: input.userId, role }));
    });
  }

  async updateClub(clubId: string, userId: string, input: UpdateBookClubInput): Promise<BookClubEntity> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId);
      if (club.ownerUserId !== userId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }

      club.name = input.name ?? club.name;
      if (input.description !== undefined) club.description = input.description;
      club.visibility = input.visibility ?? club.visibility;
      await clubRepository.save(club);

      if (input.selectedWork) {
        const workRepository = manager.getRepository(BookClubWorkEntity);
        const work = await workRepository.findOne({ where: { clubId } });
        if (!work) throw new NotFoundException('Book club not found');
        work.title = input.selectedWork.title;
        work.author = input.selectedWork.author;
        await workRepository.save(work);
      }
      return club;
    });
  }

  async getClub(clubId: string, userId: string): Promise<BookClubEntity & { selectedWork: BookClubWorkEntity }> {
    return this.dataSource.transaction(async (manager) => {
      const workRepository = manager.getRepository(BookClubWorkEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId);
      if (club.status === BookClubStatus.ARCHIVED && !actor) {
        throw new NotFoundException('Book club not found');
      }

      const selectedWork = await workRepository.findOne({ where: { clubId } });
      if (!selectedWork) throw new NotFoundException('Book club not found');
      return Object.assign(club, { selectedWork });
    });
  }

  async deleteClub(clubId: string, actorUserId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId);
      if (club.ownerUserId !== actorUserId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      await clubRepository.delete({ id: clubId });
    });
  }

  private async getVisibleClub(
    manager: EntityManager,
    clubId: string,
    actorUserId: string,
    lockClub = false,
  ): Promise<{ club: BookClubEntity; actor?: BookClubMemberEntity | null }> {
    const clubRepository = manager.getRepository(BookClubEntity);
    const club = await clubRepository.findOne({
      where: { id: clubId },
      ...(lockClub ? { lock: { mode: 'pessimistic_write' } } : {}),
    });
    if (!club) throw new NotFoundException('Book club not found');

    const actor = await manager.getRepository(BookClubMemberEntity).findOne({ where: { clubId, userId: actorUserId } });
    if (club.visibility === BookClubVisibility.PRIVATE && !actor) {
      throw new NotFoundException('Book club not found');
    }
    return { club, actor };
  }

  async createClub(
    userId: string,
    input: CreateBookClubInput,
  ): Promise<BookClubEntity & { selectedWork: BookClubWorkEntity }> {
    return this.dataSource.transaction(async (manager) => {
      const clubRepository = manager.getRepository(BookClubEntity);
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const workRepository = manager.getRepository(BookClubWorkEntity);
      const club = clubRepository.create({
        id: randomUUID(),
        name: input.name,
        description: input.description,
        visibility: input.visibility,
        status: BookClubStatus.ACTIVE,
        ownerUserId: userId,
      });
      await clubRepository.save(club);
      await memberRepository.save(memberRepository.create({ clubId: club.id, userId, role: BookClubRole.OWNER }));
      const selectedWork = await workRepository.save(
        workRepository.create({ clubId: club.id, title: input.selectedWork.title, author: input.selectedWork.author }),
      );
      return Object.assign(club, { selectedWork });
    });
  }
}
