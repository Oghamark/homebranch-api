import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';

const databaseDescribe = process.env.BOOK_CLUB_DB_INTEGRATION === 'true' ? describe : describe.skip;

databaseDescribe('Book club cover PostgreSQL lookup', () => {
  const schema = `club_cover_test_${randomUUID().replaceAll('-', '')}`;
  const userId = randomUUID();
  const otherId = randomUUID();
  const clubId = randomUUID();
  const originalCloudMode = process.env.CLOUD_MODE;
  let dataSource: DataSource;
  let service: BookClubsService;

  beforeAll(async () => {
    dataSource = await new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_USERNAME,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      schema,
      entities: [
        BookEntity,
        BookFormatEntity,
        BookShelfEntity,
        BookClubEntity,
        BookClubMemberEntity,
        BookClubWorkEntity,
      ],
    }).initialize();
    await dataSource.query(`CREATE SCHEMA "${schema}"`);
    await dataSource.synchronize();
    service = new BookClubsService(dataSource);
  }, 30000);

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dataSource.destroy();
    }
    if (originalCloudMode === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = originalCloudMode;
  });

  beforeEach(async () => {
    process.env.CLOUD_MODE = 'false';
    await dataSource.query(`TRUNCATE "${schema}".book_entity, "${schema}".book_club_entity,
      "${schema}".book_club_work_entity, "${schema}".book_club_member_entity CASCADE`);
    await dataSource.getRepository(BookClubEntity).save({
      id: clubId,
      name: 'Orchard readers',
      ownerUserId: userId,
      visibility: BookClubVisibility.INSTANCE_VISIBLE,
      status: BookClubStatus.ACTIVE,
    });
    await dataSource.getRepository(BookClubWorkEntity).save({
      clubId,
      title: 'The Orchard',
      author: 'A. Writer',
      isbn: '9781234567890',
    });
  });

  async function addBook(owner: string, cover: string, deletedAt?: Date) {
    return dataSource.getRepository(BookEntity).save({
      title: 'The Orchard',
      author: 'A. Writer',
      fileName: `${randomUUID()}.epub`,
      isFavorite: false,
      coverImageFileName: cover,
      uploadedByUserId: owner,
      deletedAt,
    });
  }

  it('returns exact-identifier artwork, not unrelated metadata or a selected private copy', async () => {
    await addBook(userId, 'metadata-match.jpg');
    const exact = await addBook(otherId, 'exact-match.jpg');
    await dataSource.getRepository(BookEntity).update(exact.id, { isbn: '9781234567890' });
    const [result] = await service.listClubs(userId);
    expect(result.selectedWork.coverImageFileName).toBe('exact-match.jpg');
    for (const key of ['fileName', 'formats', 'bookId']) expect(result.selectedWork).not.toHaveProperty(key);
    expect(await dataSource.getRepository(BookClubWorkEntity).findOneBy({ clubId })).not.toHaveProperty(
      'coverImageFileName',
    );
  });

  it('uses linked-format covers and inherited authors when the parent title differs', async () => {
    const book = await addBook(userId, 'wrong-parent.jpg');
    await dataSource.getRepository(BookEntity).update(book.id, { title: 'Collected Stories' });
    await dataSource.getRepository(BookFormatEntity).save({
      bookId: book.id,
      format: BookFormatType.EPUB,
      fileName: `${randomUUID()}.epub`,
      title: 'the orchard',
      coverImageFileName: 'format-artwork.jpg',
    });
    expect((await service.getClub(clubId, userId)).selectedWork.coverImageFileName).toBe('format-artwork.jpg');
  });

  it('excludes other users and deleted books from every Cloud matching branch', async () => {
    process.env.CLOUD_MODE = 'true';
    const privateBook = await addBook(otherId, 'private-artwork.jpg');
    await dataSource.getRepository(BookEntity).update(privateBook.id, { isbn: '9781234567890' });
    await dataSource.getRepository(BookFormatEntity).save({
      bookId: privateBook.id,
      format: BookFormatType.EPUB,
      fileName: `${randomUUID()}.epub`,
      isbn: '9781234567890',
      coverImageFileName: 'private-format.jpg',
    });
    await addBook(userId, 'deleted-artwork.jpg', new Date());
    expect((await service.getClub(clubId, userId)).selectedWork.coverImageFileName).toBeUndefined();
    await addBook(userId, 'owned-artwork.jpg');
    expect((await service.getClub(clubId, userId)).selectedWork.coverImageFileName).toBe('owned-artwork.jpg');
  });

  it('conceals private club artwork and retains it for authorized archived views', async () => {
    await addBook(userId, 'orchard.jpg');
    await dataSource.getRepository(BookClubEntity).update(clubId, { visibility: BookClubVisibility.PRIVATE });
    await expect(service.getClub(clubId, otherId)).rejects.toMatchObject({ status: 404 });
    expect(await service.listClubs(otherId)).toEqual([]);
    await dataSource.getRepository(BookClubMemberEntity).save({
      clubId,
      userId,
      role: BookClubRole.OWNER,
    });
    await dataSource.getRepository(BookClubEntity).update(clubId, { status: BookClubStatus.ARCHIVED });
    expect((await service.listArchivedClubs(userId))[0].selectedWork.coverImageFileName).toBe('orchard.jpg');
    await expect(service.getClub(clubId, otherId)).rejects.toMatchObject({ status: 404 });
  });
});
