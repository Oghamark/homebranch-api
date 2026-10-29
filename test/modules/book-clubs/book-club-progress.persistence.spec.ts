import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import {
  BookClubRole,
  BookClubStatus,
  BookClubVisibility,
  BookClubReadingCopySource,
} from 'src/modules/book-clubs/book-club.types';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import {
  BookClubMilestoneEntity,
  BookClubMilestoneKind,
} from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubMilestoneMappingEntity } from 'src/modules/book-clubs/entities/book-club-milestone-mapping.entity';
import {
  BookClubMilestoneProgressEntity,
  BookClubProgressStatus,
} from 'src/modules/book-clubs/entities/book-club-milestone-progress.entity';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';

const url = process.env.SOCIAL_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('All-member club progress PostgreSQL persistence', () => {
  const schema = `club_progress_test_${randomUUID().replaceAll('-', '')}`;
  const users = [randomUUID(), randomUUID(), randomUUID()];
  const membershipIds = users.map(() => randomUUID());
  const clubId = randomUUID();
  const workId = randomUUID();
  const steps = [randomUUID(), randomUUID()];
  const bookIds = [randomUUID(), randomUUID()];
  const originalCloud = process.env.CLOUD_MODE;
  let admin: DataSource;
  let db: DataSource;
  let service: BookClubsService;

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
        BookClubReadingCopyEntity,
        BookClubMilestoneEntity,
        BookClubMilestoneMappingEntity,
        BookClubMilestoneProgressEntity,
        BookEntity,
        BookFormatEntity,
        BookShelfEntity,
      ],
      synchronize: true,
    }).initialize();
    service = new BookClubsService(db);
  });

  afterAll(async () => {
    if (originalCloud === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = originalCloud;
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  beforeEach(async () => {
    delete process.env.CLOUD_MODE;
    await db.query(`TRUNCATE book_club_milestone_progress_entity,book_club_milestone_mapping_entity,
      book_club_reading_copy_entity,book_club_milestone_entity,book_club_work_entity,
      book_club_member_entity,book_club_entity,book_entity CASCADE`);
    await db.getRepository(BookClubEntity).save({
      id: clubId,
      name: 'Progress fixture',
      ownerUserId: users[0],
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    });
    await db
      .getRepository(BookClubWorkEntity)
      .save({ id: workId, clubId, title: 'Shared work', author: 'Fixture author' });
    for (let index = 0; index < users.length; index++) {
      await db.getRepository(BookClubMemberEntity).save({
        id: membershipIds[index],
        clubId,
        userId: users[index],
        role: index === 0 ? BookClubRole.OWNER : BookClubRole.MEMBER,
        progressSharingEnabled: false,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      });
    }
    for (let index = 0; index < steps.length; index++) {
      await db.getRepository(BookClubMilestoneEntity).save({
        id: steps[index],
        workId,
        name: `Step ${index + 1}`,
        kind: BookClubMilestoneKind.CHAPTER,
        position: index + 1,
      });
      await db.getRepository(BookEntity).save({
        id: bookIds[index],
        title: 'Private edition',
        author: 'Private author',
        fileName: `${bookIds[index]}.epub`,
        isFavorite: false,
        uploadedByUserId: users[index],
      });
      await db.getRepository(BookClubReadingCopyEntity).save({
        memberId: membershipIds[index],
        workId,
        bookId: bookIds[index],
        source: BookClubReadingCopySource.PERSONAL,
      });
    }
    await service.setMilestoneProgress(clubId, steps[0], users[0], { status: BookClubProgressStatus.COMPLETED });
    await service.setMilestoneProgress(clubId, steps[0], users[1], {
      status: BookClubProgressStatus.IN_PROGRESS,
      percentage: 65,
    });
    await service.setMilestoneMapping(clubId, steps[0], users[0], {
      memberLabel: 'Private edition label',
      memberPosition: 17,
    });
  });

  it.each([0, 1, 2])(
    'shows every member to reader %i despite legacy flags, including members without a copy',
    async (index) => {
      const schedule = await service.getSchedule(clubId, users[index]);
      expect(schedule.progressSharingEnabled).toBe(true);
      expect(schedule.sharedProgress).toEqual(
        users.map((userId, memberIndex) => ({
          userId,
          milestones: [
            {
              milestoneId: steps[0],
              status: memberIndex === 0 ? 'completed' : memberIndex === 1 ? 'in_progress' : 'not_started',
              percentage: memberIndex === 1 ? 65 : null,
            },
            { milestoneId: steps[1], status: 'not_started', percentage: null },
          ],
        })),
      );
      const shared = JSON.stringify(schedule.sharedProgress);
      for (const value of [...bookIds, 'Private edition label', 'Private author', 'Private edition'])
        expect(shared).not.toContain(value);
      if (index !== 0) expect(schedule.myMappings).toEqual([]);
      expect(
        (await db.getRepository(BookClubMemberEntity).find()).every((member) => !member.progressSharingEnabled),
      ).toBe(true);
    },
  );

  it('refreshes another member completion and undo while retaining defaults for absent steps', async () => {
    await service.setMilestoneProgress(clubId, steps[1], users[1], { status: BookClubProgressStatus.COMPLETED });
    expect((await service.getSchedule(clubId, users[0])).sharedProgress[1].milestones[1].status).toBe('completed');
    await service.setMilestoneProgress(clubId, steps[1], users[1], { status: BookClubProgressStatus.NOT_STARTED });
    expect((await service.getSchedule(clubId, users[0])).sharedProgress[1].milestones[1].status).toBe('not_started');
  });

  it('denies outsiders and excludes removed members even if orphan progress remains', async () => {
    await expect(service.getSchedule(clubId, randomUUID())).rejects.toMatchObject({ status: 404 });
    await db.getRepository(BookClubMemberEntity).delete(membershipIds[1]);
    const schedule = await service.getSchedule(clubId, users[0]);
    expect(schedule.sharedProgress.map((member) => member.userId)).toEqual([users[0], users[2]]);
    await expect(service.getSchedule(clubId, users[1])).rejects.toMatchObject({ status: 404 });
  });

  it('keeps member groups with an empty plan in archived clubs', async () => {
    await db.getRepository(BookClubEntity).update(clubId, { status: BookClubStatus.ARCHIVED });
    await db.getRepository(BookClubMilestoneProgressEntity).clear();
    await db.getRepository(BookClubMilestoneMappingEntity).clear();
    await db.getRepository(BookClubMilestoneEntity).clear();
    expect((await service.getSchedule(clubId, users[2])).sharedProgress).toEqual(
      users.map((userId) => ({ userId, milestones: [] })),
    );
  });

  it('rechecks Cloud ownership before sharing stored progress without disclosing the selected copy', async () => {
    process.env.CLOUD_MODE = 'true';
    await db.getRepository(BookEntity).update(bookIds[1], { uploadedByUserId: users[0] });
    const schedule = await service.getSchedule(clubId, users[0]);
    expect(schedule.sharedProgress[1].milestones).toEqual(
      steps.map((milestoneId) => ({ milestoneId, status: 'not_started', percentage: null })),
    );
    expect(JSON.stringify(schedule.sharedProgress)).not.toContain(bookIds[1]);
  });
});
