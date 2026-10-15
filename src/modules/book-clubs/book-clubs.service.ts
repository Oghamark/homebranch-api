import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import { isCloudMode } from 'src/common/utils/cloud';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import {
  BookClubMilestoneEntity,
  BookClubMilestoneKind,
} from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubMilestoneMappingEntity } from 'src/modules/book-clubs/entities/book-club-milestone-mapping.entity';
import {
  BookClubMilestoneProgressEntity,
  BookClubProgressStatus,
} from 'src/modules/book-clubs/entities/book-club-milestone-progress.entity';
import {
  BookClubAssociationMethod,
  BookClubReadingCopySource,
  BookClubRole,
  BookClubStatus,
  BookClubVisibility,
} from 'src/modules/book-clubs/book-club.types';
import { BookService } from 'src/modules/book/catalog/book.service';
import { matchBookClubWork } from 'src/modules/book-clubs/book-club-work-matcher';

export interface BookClubWorkInput {
  title: string;
  author: string;
  isbn?: string;
  externalWorkId?: string;
  editionId?: string;
  series?: string;
  seriesPosition?: number;
}

export interface CreateBookClubInput {
  name: string;
  visibility: BookClubVisibility;
  description?: string;
  selectedWork: BookClubWorkInput;
}

export interface AddBookClubMemberInput {
  userId: string;
  role?: BookClubRole;
}

export interface UpdateBookClubInput {
  name?: string;
  description?: string | null;
  visibility?: BookClubVisibility;
  selectedWork?: BookClubWorkInput;
}

export interface SetBookClubReadingCopyInput {
  source: BookClubReadingCopySource.SHARED | BookClubReadingCopySource.PERSONAL;
  bookId: string;
}

export interface UpdateBookClubScheduleInput {
  startDate?: string | null;
  completionDate?: string | null;
  milestones?: Array<{ name: string; kind: BookClubMilestoneKind; position: number }>;
}

export interface SetBookClubMilestoneProgressInput {
  status: BookClubProgressStatus;
  percentage?: number | null;
}

export interface SetBookClubMilestoneMappingInput {
  memberLabel: string;
  memberPosition?: number | null;
}

export interface BookClubReadingCopyState {
  clubId: string;
  workId: string;
  source: BookClubReadingCopySource;
  available: boolean;
  book: { id: string; title: string; author: string } | null;
  associationMethod?: BookClubAssociationMethod | null;
  confidence?: number | null;
}

export interface BookClubWorkMatchCandidate {
  bookId: string;
  title: string;
  author: string;
  method: BookClubAssociationMethod.IDENTIFIER | BookClubAssociationMethod.METADATA_CANDIDATE;
  confidence: number;
  confirmationRequired: true;
}

@Injectable()
export class BookClubsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() @Inject(BookService) private readonly bookService?: BookService,
  ) {}

  async setReadingCopy(
    clubId: string,
    workId: string,
    userId: string,
    input: SetBookClubReadingCopyInput,
    evidence: { associationMethod: BookClubAssociationMethod; confidence: number } = {
      associationMethod: BookClubAssociationMethod.MANUAL_CONFIRMATION,
      confidence: 1,
    },
    workMatchSnapshot?: BookClubWorkEntity,
  ): Promise<BookClubReadingCopyState> {
    await this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId);
      if (!actor) throw new ForbiddenException('Book club membership required');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }

      const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!work) throw new NotFoundException('Book club work not found');
      if (input.source !== BookClubReadingCopySource.SHARED && input.source !== BookClubReadingCopySource.PERSONAL) {
        throw new BadRequestException('Reading-copy source must be shared or personal');
      }
      if (isCloudMode() && input.source === BookClubReadingCopySource.SHARED) {
        throw new ForbiddenException('Shared book copies are not available in Cloud');
      }
    });

    if (!this.bookService) throw new Error('Book access service is not configured');
    const book = await this.bookService.getBookById(input.bookId, userId, isCloudMode() ? userId : undefined);

    return this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
      if (!actor) throw new ForbiddenException('Book club membership required');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!work) throw new NotFoundException('Book club work not found');

      let associationEvidence = evidence;
      if (workMatchSnapshot) {
        if (!sameWorkMatchMetadata(workMatchSnapshot, work)) {
          throw new BadRequestException('Selected work changed; refresh match candidates before confirming');
        }
        if (!isCloudMode()) {
          const currentMatch = matchBookClubWork(work, [book]).find((match) => match.bookId === book.id);
          if (!currentMatch) {
            throw new BadRequestException('Book is no longer a match candidate; use manual association instead');
          }
          associationEvidence = {
            associationMethod: currentMatch.method,
            confidence: currentMatch.confidence,
          };
        }
      }

      let responseBook = book;
      if (isCloudMode()) {
        const authorizedBook = await manager.getRepository(BookEntity).findOne({
          select: {
            id: true,
            title: true,
            author: true,
            isbn: true,
            externalWorkId: true,
            editionId: true,
            series: true,
            seriesPosition: true,
          },
          where: { id: input.bookId, uploadedByUserId: userId, deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        if (!authorizedBook) throw new NotFoundException('Book not found');
        responseBook = authorizedBook;

        if (workMatchSnapshot) {
          authorizedBook.formats = await manager.getRepository(BookFormatEntity).find({
            select: {
              id: true,
              bookId: true,
              title: true,
              author: true,
              isbn: true,
              externalWorkId: true,
              editionId: true,
              series: true,
              seriesPosition: true,
            },
            where: { bookId: input.bookId },
            lock: { mode: 'pessimistic_write' },
          });
          const currentMatch = matchBookClubWork(work, [authorizedBook]).find(
            (match) => match.bookId === authorizedBook.id,
          );
          if (!currentMatch) {
            throw new BadRequestException('Book is no longer a match candidate; use manual association instead');
          }
          associationEvidence = {
            associationMethod: currentMatch.method,
            confidence: currentMatch.confidence,
          };
        }
      }

      const repository = manager.getRepository(BookClubReadingCopyEntity);
      const previousAssociation = await repository.findOne({ where: { memberId: actor.id, workId } });
      if (
        previousAssociation &&
        (previousAssociation.bookId !== input.bookId || previousAssociation.source !== input.source)
      ) {
        await this.clearMemberWorkProgress(manager, actor.id, workId);
      }
      await repository.upsert(
        {
          memberId: actor.id,
          workId,
          bookId: input.bookId,
          source: input.source,
          associationMethod: associationEvidence.associationMethod,
          confidence: associationEvidence.confidence,
        },
        ['memberId', 'workId'],
      );
      return {
        clubId,
        workId,
        source: input.source,
        available: true,
        book: { id: responseBook.id, title: responseBook.title, author: responseBook.author },
        associationMethod: associationEvidence.associationMethod,
        confidence: associationEvidence.confidence,
      };
    });
  }

  async getReadingCopy(clubId: string, workId: string, userId: string): Promise<BookClubReadingCopyState> {
    const context = await this.dataSource.transaction(async (manager) => {
      const { actor } = await this.getVisibleClub(manager, clubId, userId);
      if (!actor) throw new ForbiddenException('Book club membership required');

      const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!work) throw new NotFoundException('Book club work not found');
      const association = await manager
        .getRepository(BookClubReadingCopyEntity)
        .findOne({ where: { memberId: actor.id, workId } });
      if (!association || association.source === BookClubReadingCopySource.NONE) {
        return {
          kind: 'state' as const,
          state: { clubId, workId, source: BookClubReadingCopySource.NONE, available: false, book: null },
        };
      }
      if (!association.bookId) {
        return {
          kind: 'state' as const,
          state: {
            clubId,
            workId,
            source: isCloudMode() ? BookClubReadingCopySource.NONE : association.source,
            available: false,
            book: null,
            ...associationEvidence(association, isCloudMode()),
          },
        };
      }
      if (isCloudMode() && association.source === BookClubReadingCopySource.SHARED) {
        return {
          kind: 'state' as const,
          state: { clubId, workId, source: BookClubReadingCopySource.NONE, available: false, book: null },
        };
      }
      return { kind: 'association' as const, association, bookId: association.bookId };
    });
    if (context.kind === 'state') return context.state;
    if (!this.bookService) throw new Error('Book access service is not configured');

    let lookup: { book: Awaited<ReturnType<BookService['getBookById']>> } | { error: unknown };
    try {
      lookup = { book: await this.bookService.getBookById(context.bookId, userId, isCloudMode() ? userId : undefined) };
    } catch (error) {
      lookup = { error };
    }

    const { associationIsCurrent, currentAssociation, authorizedBook } = await this.dataSource.transaction(
      async (manager) => {
        const { actor } = await this.getVisibleClub(manager, clubId, userId);
        if (!actor) throw new ForbiddenException('Book club membership required');

        const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
        if (!work) throw new NotFoundException('Book club work not found');

        const currentAssociation = await manager
          .getRepository(BookClubReadingCopyEntity)
          .findOne({ where: { memberId: actor.id, workId } });
        const associationIsCurrent =
          currentAssociation?.id === context.association.id &&
          currentAssociation?.memberId === context.association.memberId &&
          currentAssociation?.workId === context.association.workId &&
          currentAssociation?.bookId === context.association.bookId &&
          currentAssociation?.source === context.association.source &&
          currentAssociation?.associationMethod === context.association.associationMethod &&
          currentAssociation?.confidence === context.association.confidence;
        const authorizedBook =
          isCloudMode() && associationIsCurrent && 'book' in lookup
            ? await manager.getRepository(BookEntity).findOne({
                select: { id: true, title: true, author: true },
                where: { id: context.bookId, uploadedByUserId: userId, deletedAt: IsNull() },
                lock: { mode: 'pessimistic_write' },
              })
            : null;

        return { associationIsCurrent, currentAssociation, authorizedBook };
      },
    );

    if (!associationIsCurrent) {
      const source =
        !currentAssociation || currentAssociation.source === BookClubReadingCopySource.NONE || isCloudMode()
          ? BookClubReadingCopySource.NONE
          : currentAssociation.source;
      return { clubId, workId, source, available: false, book: null };
    }

    if ('error' in lookup) {
      if (!(lookup.error instanceof NotFoundException) && !(lookup.error instanceof ForbiddenException))
        throw lookup.error;
      return {
        clubId,
        workId,
        source: isCloudMode() ? BookClubReadingCopySource.NONE : context.association.source,
        available: false,
        book: null,
        ...associationEvidence(context.association, isCloudMode()),
      };
    }

    const responseBook = isCloudMode() ? authorizedBook : lookup.book;
    if (!responseBook) {
      return {
        clubId,
        workId,
        source: BookClubReadingCopySource.NONE,
        available: false,
        book: null,
      };
    }

    return {
      clubId,
      workId,
      source: context.association.source,
      available: true,
      book: { id: responseBook.id, title: responseBook.title, author: responseBook.author },
      ...associationEvidence(context.association),
    };
  }

  async getWorkMatchCandidates(clubId: string, workId: string, userId: string): Promise<BookClubWorkMatchCandidate[]> {
    return (await this.getWorkMatchCandidateSet(clubId, workId, userId)).candidates;
  }

  private async getWorkMatchCandidateSet(
    clubId: string,
    workId: string,
    userId: string,
  ): Promise<{ work: BookClubWorkEntity; candidates: BookClubWorkMatchCandidate[] }> {
    const work = await this.dataSource.transaction(async (manager) => {
      const { actor } = await this.getVisibleClub(manager, clubId, userId);
      if (!actor) throw new ForbiddenException('Book club membership required');

      const selectedWork = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!selectedWork) throw new NotFoundException('Book club work not found');
      return selectedWork;
    });

    if (!this.bookService) throw new Error('Book access service is not configured');
    let books = await this.bookService.getMatchingBooks(work, userId);
    let currentWork = await this.dataSource.transaction(async (manager) => {
      const { actor } = await this.getVisibleClub(manager, clubId, userId);
      if (!actor) throw new ForbiddenException('Book club membership required');

      const selectedWork = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!selectedWork) throw new NotFoundException('Book club work not found');
      return selectedWork;
    });

    if (!sameWorkMatchMetadata(work, currentWork)) {
      books = await this.bookService.getMatchingBooks(currentWork, userId);
      const latestWork = await this.dataSource.transaction(async (manager) => {
        const { actor } = await this.getVisibleClub(manager, clubId, userId);
        if (!actor) throw new ForbiddenException('Book club membership required');

        const selectedWork = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
        if (!selectedWork) throw new NotFoundException('Book club work not found');
        return selectedWork;
      });
      if (!sameWorkMatchMetadata(currentWork, latestWork)) return { work: latestWork, candidates: [] };
      currentWork = latestWork;
    }

    const booksById = new Map(books.map((book) => [book.id, book]));
    const candidates = matchBookClubWork(currentWork, books).flatMap((match) => {
      const book = booksById.get(match.bookId);
      return book
        ? [
            {
              ...match,
              title: book.title,
              author: book.author,
              confirmationRequired: true as const,
            },
          ]
        : [];
    });

    if (!isCloudMode() || candidates.length === 0) return { work: currentWork, candidates };

    const {
      work: lockedWork,
      books: liveBooks,
      matchesCurrentWork,
    } = await this.dataSource.transaction(async (manager) => {
      const { actor } = await this.getVisibleClub(manager, clubId, userId);
      if (!actor) throw new ForbiddenException('Book club membership required');

      const selectedWork = await manager.getRepository(BookClubWorkEntity).findOne({
        where: { id: workId, clubId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!selectedWork) throw new NotFoundException('Book club work not found');
      if (!sameWorkMatchMetadata(currentWork, selectedWork)) {
        return { work: selectedWork, books: [], matchesCurrentWork: false };
      }

      const books = await this.getCloudMatchableBooks(
        manager,
        candidates.map((candidate) => candidate.bookId),
        userId,
      );
      return { work: selectedWork, books, matchesCurrentWork: true };
    });
    if (!matchesCurrentWork) return { work: lockedWork, candidates: [] };

    const liveBooksById = new Map(liveBooks.map((book) => [book.id, book]));
    const liveMatchesById = new Map(matchBookClubWork(lockedWork, liveBooks).map((match) => [match.bookId, match]));
    const authorizedCandidates = candidates
      .flatMap((candidate) => {
        const book = liveBooksById.get(candidate.bookId);
        const match = liveMatchesById.get(candidate.bookId);
        return book && match
          ? [
              {
                ...candidate,
                method: match.method,
                confidence: match.confidence,
                title: book.title,
                author: book.author,
              },
            ]
          : [];
      })
      .sort((left, right) => right.confidence - left.confidence || left.bookId.localeCompare(right.bookId));
    return { work: lockedWork, candidates: authorizedCandidates };
  }

  async confirmWorkMatch(
    clubId: string,
    workId: string,
    userId: string,
    bookId: string,
  ): Promise<BookClubReadingCopyState> {
    const { work, candidates } = await this.getWorkMatchCandidateSet(clubId, workId, userId);
    const candidate = candidates.find((match) => match.bookId === bookId);
    if (!candidate)
      throw new BadRequestException('Book is not a current match candidate; use manual association instead');

    return this.setReadingCopy(
      clubId,
      workId,
      userId,
      { source: BookClubReadingCopySource.PERSONAL, bookId },
      { associationMethod: candidate.method, confidence: candidate.confidence },
      work,
    );
  }

  async clearReadingCopy(clubId: string, workId: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
      if (!actor) throw new ForbiddenException('Book club membership required');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: workId, clubId } });
      if (!work) throw new NotFoundException('Book club work not found');

      const repository = manager.getRepository(BookClubReadingCopyEntity);
      await this.clearMemberWorkProgress(manager, actor.id, workId);
      await repository.upsert(
        {
          memberId: actor.id,
          workId,
          bookId: null,
          source: BookClubReadingCopySource.NONE,
          associationMethod: null,
          confidence: null,
        },
        ['memberId', 'workId'],
      );
    });
  }

  async getSchedule(clubId: string, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
      if (!actor) throw new ForbiddenException('Book club membership required');
      const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { clubId } });
      if (!work) throw new NotFoundException('Book club work not found');
      const milestones = await manager.getRepository(BookClubMilestoneEntity).find({
        where: { workId: work.id },
        order: { position: 'ASC' },
      });
      const memberRepository = manager.getRepository(BookClubMemberEntity);
      const members = await memberRepository.find({ where: { clubId } });
      const memberIds = members.map((member) => member.id);
      const readingCopies = memberIds.length
        ? await manager
            .getRepository(BookClubReadingCopyEntity)
            .find({ where: { memberId: In(memberIds), workId: work.id } })
        : [];
      const selectedCopies = new Map(
        readingCopies
          .filter((copy) => copy.bookId && copy.source !== BookClubReadingCopySource.NONE)
          .map((copy) => [copy.memberId, copy]),
      );

      if (isCloudMode() && selectedCopies.size > 0) {
        const selectedBookIds = [...selectedCopies.values()].map((copy) => copy.bookId!);
        const books = await manager.getRepository(BookEntity).find({
          select: { id: true, uploadedByUserId: true },
          where: { id: In(selectedBookIds), deletedAt: IsNull() },
          lock: { mode: 'pessimistic_write' },
        });
        const authorizedBookOwners = new Map(books.map((book) => [book.id, book.uploadedByUserId]));
        for (const member of members) {
          const copy = selectedCopies.get(member.id);
          if (
            copy &&
            (copy.source !== BookClubReadingCopySource.PERSONAL ||
              authorizedBookOwners.get(copy.bookId!) !== member.userId)
          ) {
            selectedCopies.delete(member.id);
          }
        }
      } else if (!isCloudMode() && selectedCopies.size > 0) {
        const bookService = this.bookService;
        if (!bookService) throw new Error('Book access service is not configured');
        const membersById = new Map(members.map((member) => [member.id, member]));
        const inaccessibleMemberIds = await Promise.all(
          [...selectedCopies.entries()].map(async ([memberId, copy]) => {
            const selectedMember = membersById.get(memberId);
            if (!selectedMember) return memberId;
            try {
              await bookService.getBookById(copy.bookId!, selectedMember.userId);
              return null;
            } catch (error) {
              if (error instanceof NotFoundException || error instanceof ForbiddenException) return memberId;
              throw error;
            }
          }),
        );
        for (const memberId of inaccessibleMemberIds) {
          if (memberId) selectedCopies.delete(memberId);
        }
      }

      const mappingRepository = manager.getRepository(BookClubMilestoneMappingEntity);
      const progressRepository = manager.getRepository(BookClubMilestoneProgressEntity);
      const myMappings = await mappingRepository.find({ where: { memberId: actor.id, workId: work.id } });
      const myProgress = selectedCopies.has(actor.id)
        ? await progressRepository.find({ where: { memberId: actor.id, workId: work.id } })
        : [];
      const shareableMembers = members.filter(
        (member) => member.id !== actor.id && member.progressSharingEnabled && selectedCopies.has(member.id),
      );
      const sharedProgressRows = shareableMembers.length
        ? await progressRepository.find({
            where: { memberId: In(shareableMembers.map((member) => member.id)), workId: work.id },
          })
        : [];
      if (!isCloudMode() && selectedCopies.size > 0) {
        const books = await manager.getRepository(BookEntity).find({
          select: { id: true },
          where: {
            id: In([...new Set([...selectedCopies.values()].map((copy) => copy.bookId!))]),
            deletedAt: IsNull(),
          },
          lock: { mode: 'pessimistic_write' },
        });
        const availableBookIds = new Set(books.map((book) => book.id));
        for (const [memberId, copy] of selectedCopies) {
          if (!availableBookIds.has(copy.bookId!)) selectedCopies.delete(memberId);
        }
      }
      const sharedProgress = shareableMembers.flatMap((member) => {
        if (!selectedCopies.has(member.id)) return [];
        const memberProgress = sharedProgressRows
          .filter((progress) => progress.memberId === member.id)
          .map(({ milestoneId, status, percentage }) => ({ milestoneId, status, percentage: percentage ?? null }));
        return memberProgress.length ? [{ userId: member.userId, milestones: memberProgress }] : [];
      });

      return {
        clubId,
        startDate: club.startDate ?? null,
        completionDate: club.completionDate ?? null,
        milestones: milestones.map(({ id, name, kind, position }) => ({ id, name, kind, position })),
        progressSharingEnabled: actor.progressSharingEnabled ?? false,
        myMappings: myMappings.map(({ milestoneId, memberLabel, memberPosition }) => ({
          milestoneId,
          memberLabel,
          memberPosition: memberPosition ?? null,
        })),
        myProgress: selectedCopies.has(actor.id)
          ? myProgress.map(({ milestoneId, status, percentage }) => ({
              milestoneId,
              status,
              percentage: percentage ?? null,
            }))
          : [],
        sharedProgress,
      };
    });
  }

  async updateSchedule(clubId: string, userId: string, input: UpdateBookClubScheduleInput) {
    return this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
      if (!actor) throw new ForbiddenException('Book club membership required');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      if (actor.role !== BookClubRole.OWNER && actor.role !== BookClubRole.MODERATOR) {
        throw new ForbiddenException('Club schedule management permission required');
      }

      const startDate = input.startDate === undefined ? (club.startDate ?? null) : input.startDate;
      const completionDate = input.completionDate === undefined ? (club.completionDate ?? null) : input.completionDate;
      if ((startDate && !isDateOnly(startDate)) || (completionDate && !isDateOnly(completionDate))) {
        throw new BadRequestException('Schedule dates must be valid ISO calendar dates');
      }
      if (startDate && completionDate && startDate > completionDate) {
        throw new BadRequestException('Schedule completion date cannot be earlier than its start date');
      }

      let work: BookClubWorkEntity | null = null;
      if (input.milestones !== undefined) {
        const positions = input.milestones.map(({ position }) => position);
        if (
          input.milestones.some(
            ({ name, kind, position }) =>
              !name.trim() ||
              name.length > 120 ||
              !Object.values(BookClubMilestoneKind).includes(kind) ||
              !Number.isInteger(position) ||
              position < 1,
          ) ||
          new Set(positions).size !== positions.length
        ) {
          throw new BadRequestException('Milestones require unique positive positions, valid kinds, and names');
        }
        work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { clubId } });
        if (!work) throw new NotFoundException('Book club work not found');
      }

      club.startDate = startDate;
      club.completionDate = completionDate;
      await manager.getRepository(BookClubEntity).save(club);

      let milestones: BookClubMilestoneEntity[] = [];
      if (input.milestones !== undefined && work) {
        const workId = work.id;
        const repository = manager.getRepository(BookClubMilestoneEntity);
        await repository.delete({ workId });
        milestones = await repository.save(
          input.milestones.map((milestone) => ({ id: randomUUID(), workId, ...milestone })),
        );
      } else if (input.milestones === undefined) {
        const selectedWork = await manager.getRepository(BookClubWorkEntity).findOne({ where: { clubId } });
        if (!selectedWork) throw new NotFoundException('Book club work not found');
        milestones = await manager.getRepository(BookClubMilestoneEntity).find({
          where: { workId: selectedWork.id },
          order: { position: 'ASC' },
        });
      }

      return {
        clubId,
        startDate: club.startDate ?? null,
        completionDate: club.completionDate ?? null,
        milestones: milestones
          .sort((left, right) => left.position - right.position)
          .map(({ id, name, kind, position }) => ({ id, name, kind, position })),
      };
    });
  }

  async setProgressSharing(clubId: string, userId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    if (typeof enabled !== 'boolean') throw new BadRequestException('Progress-sharing preference must be a boolean');
    return this.dataSource.transaction(async (manager) => {
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
      if (!actor) throw new ForbiddenException('Book club membership required');
      if (club.status !== BookClubStatus.ACTIVE) {
        throw new ForbiddenException('Archived book clubs cannot be changed');
      }
      actor.progressSharingEnabled = enabled;
      await manager.getRepository(BookClubMemberEntity).save(actor);
      return { enabled };
    });
  }

  async setMilestoneMapping(
    clubId: string,
    milestoneId: string,
    userId: string,
    input: SetBookClubMilestoneMappingInput,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const context = await this.getMemberMilestoneContext(manager, clubId, milestoneId, userId);
      if (
        !input.memberLabel.trim() ||
        input.memberLabel.length > 120 ||
        (input.memberPosition !== undefined &&
          input.memberPosition !== null &&
          (!Number.isInteger(input.memberPosition) || input.memberPosition < 1))
      ) {
        throw new BadRequestException('Member milestone mapping requires a label and a positive optional position');
      }
      await manager.getRepository(BookClubMilestoneMappingEntity).upsert(
        {
          memberId: context.actor.id,
          workId: context.work.id,
          milestoneId,
          memberLabel: input.memberLabel,
          memberPosition: input.memberPosition ?? null,
        },
        ['memberId', 'milestoneId'],
      );
      return {
        milestoneId,
        memberLabel: input.memberLabel,
        memberPosition: input.memberPosition ?? null,
      };
    });
  }

  async clearMilestoneMapping(clubId: string, milestoneId: string, userId: string): Promise<void> {
    return this.dataSource.transaction(async (manager) => {
      const context = await this.getMemberMilestoneContext(manager, clubId, milestoneId, userId);
      await manager.getRepository(BookClubMilestoneMappingEntity).delete({
        memberId: context.actor.id,
        milestoneId,
      });
    });
  }

  async setMilestoneProgress(
    clubId: string,
    milestoneId: string,
    userId: string,
    input: SetBookClubMilestoneProgressInput,
  ) {
    return this.dataSource.transaction(async (manager) => {
      const context = await this.getMemberMilestoneContext(manager, clubId, milestoneId, userId);
      if (
        !Object.values(BookClubProgressStatus).includes(input.status) ||
        (input.percentage !== undefined &&
          input.percentage !== null &&
          (!Number.isInteger(input.percentage) || input.percentage < 0 || input.percentage > 100))
      ) {
        throw new BadRequestException('Progress requires a supported status and optional percentage from 0 to 100');
      }
      await manager.getRepository(BookClubMilestoneProgressEntity).upsert(
        {
          memberId: context.actor.id,
          workId: context.work.id,
          milestoneId,
          status: input.status,
          percentage: input.percentage ?? null,
        },
        ['memberId', 'milestoneId'],
      );
      return { milestoneId, status: input.status, percentage: input.percentage ?? null };
    });
  }

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
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
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
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId, true);
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
      const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
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
        const selectedWork = {
          ...work,
          ...input.selectedWork,
          isbn: input.selectedWork.isbn ?? null,
          externalWorkId: input.selectedWork.externalWorkId ?? null,
          editionId: input.selectedWork.editionId ?? null,
          series: input.selectedWork.series ?? null,
          seriesPosition: input.selectedWork.seriesPosition ?? null,
        };
        const workReplaced = !sameWorkMatchMetadata(work, selectedWork);
        Object.assign(work, {
          ...selectedWork,
        });
        await workRepository.save(work);
        if (workReplaced) {
          club.startDate = null;
          club.completionDate = null;
          await clubRepository.save(club);
          await manager.getRepository(BookClubMilestoneEntity).delete({ workId: work.id });
          await manager.getRepository(BookClubReadingCopyEntity).update(
            { workId: work.id },
            {
              bookId: null,
              source: BookClubReadingCopySource.NONE,
              associationMethod: null,
              confidence: null,
            },
          );
        }
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
      const { club, actor } = await this.getVisibleClub(manager, clubId, actorUserId, true);
      if (club.ownerUserId !== actorUserId || actor?.role !== BookClubRole.OWNER) {
        throw new ForbiddenException('Only the club owner can perform this action');
      }
      await clubRepository.delete({ id: clubId });
    });
  }

  private async clearMemberWorkProgress(manager: EntityManager, memberId: string, workId: string): Promise<void> {
    await manager.getRepository(BookClubMilestoneProgressEntity).delete({ memberId, workId });
    await manager.getRepository(BookClubMilestoneMappingEntity).delete({ memberId, workId });
  }

  private async getMemberMilestoneContext(
    manager: EntityManager,
    clubId: string,
    milestoneId: string,
    userId: string,
  ): Promise<{ actor: BookClubMemberEntity; work: BookClubWorkEntity }> {
    const { club, actor } = await this.getVisibleClub(manager, clubId, userId, true);
    if (!actor) throw new ForbiddenException('Book club membership required');
    if (club.status !== BookClubStatus.ACTIVE) {
      throw new ForbiddenException('Archived book clubs cannot be changed');
    }

    const milestone = await manager.getRepository(BookClubMilestoneEntity).findOne({ where: { id: milestoneId } });
    if (!milestone) throw new NotFoundException('Book club milestone not found');
    const work = await manager.getRepository(BookClubWorkEntity).findOne({ where: { id: milestone.workId, clubId } });
    if (!work) throw new NotFoundException('Book club milestone not found');

    const copy = await manager.getRepository(BookClubReadingCopyEntity).findOne({
      where: { memberId: actor.id, workId: work.id },
    });
    if (!copy?.bookId || copy.source === BookClubReadingCopySource.NONE) {
      throw new ForbiddenException('Select a reading copy before updating milestone progress');
    }
    if (isCloudMode()) {
      if (copy.source !== BookClubReadingCopySource.PERSONAL) {
        throw new ForbiddenException('A currently authorized personal reading copy is required');
      }
      const book = await manager.getRepository(BookEntity).findOne({
        select: { id: true },
        where: { id: copy.bookId, uploadedByUserId: userId, deletedAt: IsNull() },
        lock: { mode: 'pessimistic_write' },
      });
      if (!book) throw new NotFoundException('Book not found');
    } else {
      if (!this.bookService) throw new Error('Book access service is not configured');
      await this.bookService.getBookById(copy.bookId, userId);
    }
    return { actor, work };
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

  private async getCloudMatchableBooks(
    manager: EntityManager,
    bookIds: string[],
    userId: string,
  ): Promise<BookEntity[]> {
    if (bookIds.length === 0) return [];

    const books = await manager.getRepository(BookEntity).find({
      select: {
        id: true,
        title: true,
        author: true,
        isbn: true,
        externalWorkId: true,
        editionId: true,
        series: true,
        seriesPosition: true,
      },
      where: { id: In(bookIds), uploadedByUserId: userId, deletedAt: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (books.length === 0) return [];

    const formats = await manager.getRepository(BookFormatEntity).find({
      select: {
        id: true,
        bookId: true,
        title: true,
        author: true,
        isbn: true,
        externalWorkId: true,
        editionId: true,
        series: true,
        seriesPosition: true,
      },
      where: { bookId: In(books.map((book) => book.id)) },
      lock: { mode: 'pessimistic_write' },
    });
    const formatsByBookId = new Map<string, BookFormatEntity[]>();
    for (const format of formats) {
      const bookFormats = formatsByBookId.get(format.bookId) ?? [];
      bookFormats.push(format);
      formatsByBookId.set(format.bookId, bookFormats);
    }

    return books.map((book) => Object.assign(book, { formats: formatsByBookId.get(book.id) ?? [] }));
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
      const selectedWork = await workRepository.save(workRepository.create({ clubId: club.id, ...input.selectedWork }));
      return Object.assign(club, { selectedWork });
    });
  }
}

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sameWorkMatchMetadata(left: BookClubWorkEntity, right: BookClubWorkEntity): boolean {
  return (
    left.title === right.title &&
    left.author === right.author &&
    (left.isbn ?? null) === (right.isbn ?? null) &&
    (left.externalWorkId ?? null) === (right.externalWorkId ?? null) &&
    (left.editionId ?? null) === (right.editionId ?? null) &&
    (left.series ?? null) === (right.series ?? null) &&
    (left.seriesPosition ?? null) === (right.seriesPosition ?? null)
  );
}

function associationEvidence(
  association: BookClubReadingCopyEntity,
  hideEvidence = false,
): Pick<BookClubReadingCopyState, 'associationMethod' | 'confidence'> | Record<string, never> {
  if (hideEvidence || !association.associationMethod) return {};
  return {
    associationMethod: association.associationMethod,
    confidence: association.confidence ?? null,
  };
}
