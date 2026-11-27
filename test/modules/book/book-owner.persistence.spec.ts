import { randomUUID } from 'crypto';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { UserBookFavoriteEntity } from 'src/modules/book/user-book-favorite.entity';

const url = process.env.SOCIAL_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('book owner PostgreSQL persistence', () => {
  const schema = `book_owner_test_${randomUUID().replaceAll('-', '')}`;
  let admin: DataSource;
  let db: DataSource;
  let books: BookService;

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await new DataSource({
      type: 'postgres',
      url,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      namingStrategy: new SnakeNamingStrategy(),
      entities: [BookEntity, BookFormatEntity, BookShelfEntity, UserBookFavoriteEntity],
      synchronize: true,
    }).initialize();
    const persistence = new BookPersistenceService(
      db.getRepository(BookEntity),
      db.getRepository(BookFormatEntity),
      db.getRepository(UserBookFavoriteEntity),
      { hydrateStoredFormatMetadata: (book: BookEntity) => Promise.resolve(book) } as never,
      {} as never,
    );
    books = new BookService(persistence, {} as never, {} as never, {} as never, {} as never);
  });

  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });

  it('clears and reassigns only the owner in the persisted row', async () => {
    const id = randomUUID();
    const originalOwner = randomUUID();
    const nextOwner = randomUUID();
    const repository = db.getRepository(BookEntity);
    await repository.save({
      id,
      title: 'Persisted book',
      author: 'Author',
      fileName: 'book.epub',
      isFavorite: false,
      uploadedByUserId: originalOwner,
    });

    await books.assignBookOwner(id, null, true);
    expect(await repository.findOneByOrFail({ id })).toMatchObject({
      title: 'Persisted book',
      uploadedByUserId: null,
    });

    await books.assignBookOwner(id, nextOwner, true);
    expect(await repository.findOneByOrFail({ id })).toMatchObject({
      title: 'Persisted book',
      uploadedByUserId: nextOwner,
    });
  });

  it('does not update deleted books or permit non-admin assignment', async () => {
    const id = randomUUID();
    const owner = randomUUID();
    const repository = db.getRepository(BookEntity);
    await repository.save({
      id,
      title: 'Deleted book',
      author: 'Author',
      fileName: 'deleted.epub',
      isFavorite: false,
      uploadedByUserId: owner,
      deletedAt: new Date(),
    });
    await expect(books.assignBookOwner(id, null, false)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(books.assignBookOwner(id, null, true)).rejects.toBeInstanceOf(NotFoundException);
    expect((await repository.findOneByOrFail({ id })).uploadedByUserId).toBe(owner);
  });
});
