import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { randomUUID } from 'crypto';
import { BulkBooksDto, BulkOwnerDto, BulkShelfDto } from 'src/modules/book/bulk/bulk-book.dto';
import { BulkBookController } from 'src/modules/book/bulk/bulk-book.controller';
import { BulkBookService } from 'src/modules/book/bulk/bulk-book.service';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from 'src/common/guards/roles.decorator';

describe('bulk book DTO validation', () => {
  const id = randomUUID();
  const errors = (value: object) => validate(value);

  it('requires 1 to 100 unique UUIDs, case-insensitively', async () => {
    for (const bookIds of [undefined, [], [id, id.toUpperCase()], ['bad'], Array.from({ length: 101 }, randomUUID)]) {
      expect(await errors(Object.assign(new BulkBooksDto(), { bookIds }))).not.toHaveLength(0);
    }
    expect(
      await errors(Object.assign(new BulkBooksDto(), { bookIds: Array.from({ length: 100 }, randomUUID) })),
    ).toHaveLength(0);
  });

  it('requires a valid shelf and an explicit nullable owner', async () => {
    expect(await errors(Object.assign(new BulkShelfDto(), { bookIds: [id] }))).not.toHaveLength(0);
    expect(await errors(Object.assign(new BulkShelfDto(), { bookIds: [id], shelfId: id }))).toHaveLength(0);
    expect(await errors(Object.assign(new BulkOwnerDto(), { bookIds: [id] }))).not.toHaveLength(0);
    expect(await errors(Object.assign(new BulkOwnerDto(), { bookIds: [id], ownerId: 'bad' }))).not.toHaveLength(0);
    expect(await errors(Object.assign(new BulkOwnerDto(), { bookIds: [id], ownerId: null }))).toHaveLength(0);
    expect(await errors(Object.assign(new BulkOwnerDto(), { bookIds: [id], ownerId: id }))).toHaveLength(0);
  });
});

describe('bulk book operations', () => {
  const previousCloud = process.env.CLOUD_MODE;
  const user = { id: 'alice', roles: ['USER'] };
  const admin = { id: 'admin', roles: ['ADMIN'] };
  let rows: Map<string, { id: string; uploadedByUserId?: string | null }>;
  let members: Set<string>;
  let favorites: Set<string>;
  let persistence: {
    findBookById: jest.Mock;
    permanentDeleteBook: jest.Mock;
    setBookOwner: jest.Mock;
    setBookFavorite: jest.Mock;
  };
  let directory: { requireAccount: jest.Mock };
  let bulk: BulkBookService;

  beforeEach(() => {
    process.env.CLOUD_MODE = 'false';
    rows = new Map([
      ['a', { id: 'a', uploadedByUserId: 'alice' }],
      ['b', { id: 'b', uploadedByUserId: 'bob' }],
      ['c', { id: 'c', uploadedByUserId: 'alice' }],
    ]);
    members = new Set(['b']);
    favorites = new Set();
    persistence = {
      findBookById: jest.fn((id: string, _viewer?: string, scope?: string) => {
        const row = rows.get(id);
        if (!row || (scope && row.uploadedByUserId !== scope)) throw new NotFoundException('Book not found');
        return Promise.resolve({ ...row });
      }),
      permanentDeleteBook: jest.fn((id: string) => Promise.resolve(rows.delete(id))),
      setBookOwner: jest.fn((id: string, ownerId: string | null) => {
        const row = rows.get(id);
        if (!row) throw new NotFoundException('Book not found');
        row.uploadedByUserId = ownerId;
        return Promise.resolve(row);
      }),
      setBookFavorite: jest.fn((uid: string, id: string, favorite: boolean) => {
        if (favorite) favorites.add(`${uid}:${id}`);
        else favorites.delete(`${uid}:${id}`);
        return Promise.resolve();
      }),
    };
    const books = new BookService(persistence as never, {} as never, {} as never, {} as never, {} as never);
    const shelfRepo = {
      findOne: jest.fn(() =>
        Promise.resolve({
          id: 'shelf',
          createdByUserId: 'alice',
          books: [...members].map((id) => ({ id })),
        }),
      ),
      createQueryBuilder: () => ({
        relation: () => ({
          of: () => ({
            add: (id: string) => Promise.resolve(members.add(id)),
            remove: (id: string) => Promise.resolve(members.delete(id)),
          }),
        }),
      }),
    };
    const bookRepo = {
      findOne: jest.fn(({ where }: { where: { id: string; uploadedByUserId?: string } }) => {
        const row = rows.get(where.id);
        return Promise.resolve(
          row && (!where.uploadedByUserId || row.uploadedByUserId === where.uploadedByUserId) ? row : null,
        );
      }),
    };
    const shelves = new BookShelfService(shelfRepo as never, bookRepo as never);
    directory = { requireAccount: jest.fn().mockResolvedValue({ id: 'owner' }) };
    bulk = new BulkBookService(books, persistence as never, shelves, directory as never);
  });

  afterAll(() => {
    if (previousCloud === undefined) delete process.env.CLOUD_MODE;
    else process.env.CLOUD_MODE = previousCloud;
  });

  it('deletes only permitted books, reporting missing and non-owned books', async () => {
    const result = await bulk.delete(['a', 'b', 'missing'], user);
    expect(result).toEqual({
      success: false,
      succeeded: ['a'],
      failed: [
        { bookId: 'b', message: 'Only the uploader or an admin can delete this book' },
        { bookId: 'missing', message: 'Book not found' },
      ],
    });
    expect([...rows.keys()]).toEqual(['b', 'c']);
  });

  it('enforces cloud scope before any mutation', async () => {
    process.env.CLOUD_MODE = 'true';
    expect(await bulk.favorite(['a', 'b', 'missing'], user, true)).toEqual({
      success: false,
      succeeded: ['a'],
      failed: [
        { bookId: 'b', message: 'Book not found' },
        { bookId: 'missing', message: 'Book not found' },
      ],
    });
    expect([...favorites]).toEqual(['alice:a']);
    expect((await bulk.delete(['b'], user)).failed).toHaveLength(1);
    expect(rows.has('b')).toBe(true);
  });

  it('sets favorites and unfavorites idempotently', async () => {
    await bulk.favorite(['a'], user, true);
    await bulk.favorite(['a'], user, true);
    expect([...favorites]).toEqual(['alice:a']);
    await bulk.favorite(['a'], user, false);
    await bulk.favorite(['a'], user, false);
    expect([...favorites]).toEqual([]);
  });

  it('preserves shelf membership and rejects inaccessible shelves and books', async () => {
    await bulk.shelf(['a', 'a'], 'shelf', user, true);
    expect([...members].sort()).toEqual(['a', 'b']);
    await bulk.shelf(['a', 'a'], 'shelf', user, false);
    expect([...members]).toEqual(['b']);
    expect((await bulk.shelf(['b'], 'shelf', { id: 'bob' }, false)).failed).toHaveLength(1);
    expect([...members]).toEqual(['b']);
    process.env.CLOUD_MODE = 'true';
    expect((await bulk.shelf(['b', 'missing'], 'shelf', user, false)).failed).toHaveLength(2);
    expect([...members]).toEqual(['b']);
    expect((await bulk.shelf(['b'], 'shelf', admin, false)).success).toBe(true);
    expect([...members]).toEqual([]);
  });

  it('requires admin and verifies a live owner, including null unassignment', async () => {
    expect(() => bulk.assignOwner(['a'], null, user)).toThrow(ForbiddenException);
    expect((await bulk.assignOwner(['a', 'c'], 'owner', admin, 'credential')).success).toBe(true);
    expect(directory.requireAccount).toHaveBeenCalledTimes(1);
    expect(directory.requireAccount).toHaveBeenCalledWith('owner', 'credential');
    expect(rows.get('a')?.uploadedByUserId).toBe('owner');
    expect((await bulk.assignOwner(['a'], null, admin)).success).toBe(true);
    expect(rows.get('a')?.uploadedByUserId).toBeNull();
    directory.requireAccount.mockRejectedValue(new NotFoundException('Account is unavailable'));
    expect((await bulk.assignOwner(['c'], 'missing', admin, 'credential')).failed).toEqual([
      { bookId: 'c', message: 'Account is unavailable' },
    ]);
    expect(rows.get('c')?.uploadedByUserId).toBe('owner');
  });

  it('logs unexpected failures without exposing their details', async () => {
    persistence.setBookFavorite.mockRejectedValueOnce(new Error('secret'));
    expect(await bulk.favorite(['a', 'c'], user, true)).toEqual({
      success: false,
      succeeded: ['c'],
      failed: [{ bookId: 'a', message: 'Unable to process book' }],
    });
  });
});

describe('favorite persistence', () => {
  it('uses conflict-ignore inserts and scoped deletes', async () => {
    const query = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn(),
    };
    const favorites = { createQueryBuilder: jest.fn().mockReturnValue(query), delete: jest.fn() };
    const service = new BookPersistenceService({} as never, {} as never, favorites as never, {} as never, {} as never);
    await service.setBookFavorite('user', 'book', true);
    await service.setBookFavorite('user', 'book', false);
    expect(query.values).toHaveBeenCalledWith({ userId: 'user', bookId: 'book' });
    expect(query.orIgnore).toHaveBeenCalledTimes(1);
    expect(favorites.delete).toHaveBeenCalledWith({ userId: 'user', bookId: 'book' });
  });
});

describe('bulk controller', () => {
  it('protects all operations and restricts owner assignment to admins', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, BulkBookController)).toContain(JwtAuthGuard);
    expect(Reflect.getMetadata(GUARDS_METADATA, BulkBookController.prototype.assignOwner)).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, BulkBookController.prototype.assignOwner)).toEqual(['ADMIN']);
  });

  it('forwards the authenticated user and each operation', async () => {
    const bulk = { delete: jest.fn(), favorite: jest.fn(), shelf: jest.fn(), assignOwner: jest.fn() };
    const controller = new BulkBookController(bulk as never);
    const user = { id: 'user', roles: ['ADMIN'] } as Express.User;
    const dto = { bookIds: ['book'] };
    await controller.delete(dto, user);
    await controller.favorite(dto, user);
    await controller.unfavorite(dto, user);
    await controller.addToShelf({ ...dto, shelfId: 'shelf' }, user);
    await controller.removeFromShelf({ ...dto, shelfId: 'shelf' }, user);
    await controller.assignOwner({ ...dto, ownerId: null }, user, {} as never);
    await controller.assignOwner({ ...dto, ownerId: 'owner' }, user, {
      cookies: { access_token: 'token' },
    } as never);
    expect(bulk.delete).toHaveBeenCalledWith(dto.bookIds, user);
    expect(bulk.favorite.mock.calls).toEqual([
      [dto.bookIds, user, true],
      [dto.bookIds, user, false],
    ]);
    expect(bulk.shelf.mock.calls).toEqual([
      [dto.bookIds, 'shelf', user, true],
      [dto.bookIds, 'shelf', user, false],
    ]);
    expect(bulk.assignOwner.mock.calls).toEqual([
      [dto.bookIds, null, user, undefined],
      [dto.bookIds, 'owner', user, 'token'],
    ]);
  });
});
