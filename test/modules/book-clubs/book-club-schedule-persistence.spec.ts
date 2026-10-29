import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import {
  BookClubMilestoneEntity,
  BookClubMilestoneKind,
} from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubMilestoneMappingEntity } from 'src/modules/book-clubs/entities/book-club-milestone-mapping.entity';
import { BookClubMilestoneProgressEntity } from 'src/modules/book-clubs/entities/book-club-milestone-progress.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { AddBookClubSchedules1790000000006 } from 'src/migrations/1790000000006-AddBookClubSchedules';
import { AddBookClubPrivacyProgress1790000000007 } from 'src/migrations/1790000000007-AddBookClubPrivacyProgress';

const databaseDescribe = process.env.BOOK_CLUB_DB_INTEGRATION === 'true' ? describe : describe.skip;

databaseDescribe('Book club schedule PostgreSQL persistence', () => {
  const schema = `club_schedule_test_${randomUUID().replaceAll('-', '')}`;
  const clubId = randomUUID();
  const workId = randomUUID();
  const userId = randomUUID();
  const memberId = randomUUID();
  const ids = [randomUUID(), randomUUID(), randomUUID()];
  const options = {
    type: 'postgres' as const,
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 5432),
    username: process.env.DATABASE_USERNAME,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    schema,
    logging: false as const,
    extra: { application_name: schema },
  };
  let setup: DataSource;
  let dataSource: DataSource;
  let service: BookClubsService;
  const baseEntities = [BookClubEntity, BookClubMemberEntity, BookClubWorkEntity];

  beforeAll(async () => {
    setup = await new DataSource({ ...options, entities: baseEntities }).initialize();
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.synchronize();
    const runner = setup.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`SET search_path TO "${schema}", public`);
      await runner.query('ALTER TABLE book_club_entity DROP COLUMN start_date, DROP COLUMN completion_date');
      await runner.query('ALTER TABLE book_club_member_entity DROP COLUMN progress_sharing_enabled');
      await new AddBookClubSchedules1790000000006().up(runner);
      await new AddBookClubPrivacyProgress1790000000007().up(runner);
    } finally {
      await runner.query('SET search_path TO public');
      await runner.release();
    }
    dataSource = await new DataSource({
      ...options,
      entities: [
        ...baseEntities,
        BookClubMilestoneEntity,
        BookClubMilestoneMappingEntity,
        BookClubMilestoneProgressEntity,
      ],
    }).initialize();
    service = new BookClubsService(dataSource);
  }, 30000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
    if (setup?.isInitialized) {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.destroy();
    }
  });

  beforeEach(async () => {
    await dataSource.query(`TRUNCATE "${schema}".book_club_milestone_entity CASCADE`);
    await dataSource.getRepository(BookClubEntity).save({
      id: clubId,
      name: 'Persistence test',
      ownerUserId: userId,
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
      startDate: null,
      completionDate: null,
    });
    await dataSource
      .getRepository(BookClubMemberEntity)
      .save({ id: memberId, clubId, userId, role: BookClubRole.OWNER });
    await dataSource.getRepository(BookClubWorkEntity).save({ id: workId, clubId, title: 'Work', author: 'Author' });
    for (let index = 0; index < ids.length; index++) {
      await dataSource.getRepository(BookClubMilestoneEntity).save({
        id: ids[index],
        workId,
        name: `Step ${index + 1}`,
        kind: BookClubMilestoneKind.PART,
        position: index + 1,
      });
      await dataSource.query(
        `INSERT INTO "${schema}".book_club_milestone_mapping_entity
          (member_id, work_id, milestone_id, member_label, member_position) VALUES ($1, $2, $3, $4, $5)`,
        [memberId, workId, ids[index], `Edition ${index + 1}`, index + 1],
      );
      await dataSource.query(
        `INSERT INTO "${schema}".book_club_milestone_progress_entity
          (member_id, work_id, milestone_id, status, percentage) VALUES ($1, $2, $3, 'completed', 100)`,
        [memberId, workId, ids[index]],
      );
    }
  });

  async function dependentRows() {
    return {
      mappings: await dataSource.getRepository(BookClubMilestoneMappingEntity).find({ order: { milestoneId: 'ASC' } }),
      progress: await dataSource.getRepository(BookClubMilestoneProgressEntity).find({ order: { milestoneId: 'ASC' } }),
    };
  }

  it('swaps retained IDs under immediate uniqueness checks while preserving their dependent rows', async () => {
    await expect(
      dataSource.getRepository(BookClubMilestoneEntity).update(ids[0], { position: 2 }),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    const before = await dependentRows();
    const result = await service.patchSchedule(clubId, userId, {
      milestones: [
        { id: ids[0], name: 'Renamed first', kind: BookClubMilestoneKind.CHAPTER, position: 2 },
        { id: ids[1], name: 'Renamed second', kind: BookClubMilestoneKind.PART, position: 1 },
        { name: 'New step', kind: BookClubMilestoneKind.CHECKPOINT, position: 3 },
      ],
    });
    expect(result.milestones.slice(0, 2).map(({ id }) => id)).toEqual([ids[1], ids[0]]);
    expect(ids).not.toContain(result.milestones[2].id);
    const after = await dependentRows();
    expect(after.mappings).toEqual(before.mappings.filter(({ milestoneId }) => milestoneId !== ids[2]));
    expect(after.progress).toEqual(before.progress.filter(({ milestoneId }) => milestoneId !== ids[2]));
    expect(await dataSource.getRepository(BookClubMilestoneEntity).findOneBy({ id: ids[2] })).toBeNull();
  });

  it('preserves every milestone, mapping and progress row for date-only patches', async () => {
    const before = await dependentRows();
    const milestones = await dataSource.getRepository(BookClubMilestoneEntity).find({ order: { position: 'ASC' } });
    await service.patchSchedule(clubId, userId, { completionDate: '2026-12-01' });
    expect(await dependentRows()).toEqual(before);
    expect(await dataSource.getRepository(BookClubMilestoneEntity).find({ order: { position: 'ASC' } })).toEqual(
      milestones,
    );
  });

  it('rejects foreign IDs before persisting dates or cascading dependent data', async () => {
    const before = await dependentRows();
    await expect(
      service.patchSchedule(clubId, userId, {
        startDate: '2026-11-01',
        milestones: [{ id: randomUUID(), name: 'Foreign step', kind: BookClubMilestoneKind.PART, position: 1 }],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(await dependentRows()).toEqual(before);
    expect((await dataSource.getRepository(BookClubEntity).findOneByOrFail({ id: clubId })).startDate).toBeNull();
  });

  it('waits for the club write lock before updating milestones', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    let pending: ReturnType<BookClubsService['patchSchedule']> | undefined;
    try {
      await runner.manager.getRepository(BookClubEntity).findOneOrFail({
        where: { id: clubId },
        lock: { mode: 'pessimistic_write' },
      });
      pending = service.patchSchedule(clubId, userId, {
        milestones: ids.map((id, index) => ({
          id,
          name: `Moved ${index}`,
          kind: BookClubMilestoneKind.PART,
          position: ids.length - index,
        })),
      });
      let waiting = false;
      for (let attempt = 0; attempt < 50 && !waiting; attempt++) {
        await runner.query('SELECT pg_stat_clear_snapshot()');
        const rows: unknown = await runner.query(
          `SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = 'Lock'`,
          [schema],
        );
        waiting = Array.isArray(rows) && rows.length > 0;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      expect(
        (await runner.manager.getRepository(BookClubMilestoneEntity).find({ order: { position: 'ASC' } })).map(
          ({ id }) => id,
        ),
      ).toEqual(ids);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
      if (pending) await pending;
    }
    expect(
      (await dataSource.getRepository(BookClubMilestoneEntity).find({ order: { position: 'ASC' } })).map(
        ({ id }) => id,
      ),
    ).toEqual([...ids].reverse());
  });
});
