import { randomUUID } from 'crypto';
import { Readable } from 'stream';
import * as AdmZip from 'adm-zip';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { CreateKoreader1790000000011 } from 'src/migrations/1790000000011-CreateKoreader';
import { KoreaderVerifiedContent1790000000012 } from 'src/migrations/1790000000012-KoreaderVerifiedContent';
import { KoreaderAuthService, SyncActor, verifier } from 'src/modules/koreader/koreader-auth.service';
import { KoreaderDocumentService } from 'src/modules/koreader/koreader-document.service';
import { KoreaderService } from 'src/modules/koreader/koreader.service';
import { lockSyncUser, nextSyncRevision } from 'src/modules/koreader/koreader-ordering';
import { partialMd5 } from 'src/modules/koreader/partial-md5';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { KOREADER_ENTITIES } from 'src/modules/koreader/koreader.entity';
import { ContentHashService } from 'src/modules/book/format/content-hash.service';

const url = process.env.KOREADER_TEST_DATABASE_URL;
const integration = url ? describe : describe.skip;

integration('KOReader PostgreSQL migrations, isolation, ordering and retries', () => {
  const schema = `koreader_test_${randomUUID().replaceAll('-', '')}`;
  const user: SyncActor = { id: randomUUID(), roles: [] };
  const other: SyncActor = { id: randomUUID(), roles: ['ADMIN'] };
  const book = randomUUID();
  const format = randomUUID();
  const document = 'a'.repeat(32);
  const originalCloud = process.env.CLOUD_MODE;
  let admin: DataSource;
  let db: DataSource;
  let auth: KoreaderAuthService;
  let documents: KoreaderDocumentService;
  let service: KoreaderService;
  let saved: SavedPositionService;
  let bytes: Buffer;
  const opf = (title: string) =>
    `<package><metadata><title>${title}</title></metadata><manifest><item id="one" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/></spine></package>`;
  const storage = {
    getFileStats: jest.fn(() => Promise.resolve({ size: bytes.length, mtimeMs: 1 })),
    getFileStream: jest.fn((_key, range?) =>
      Promise.resolve({
        stream: Readable.from([range ? bytes.subarray(range.start, range.end + 1) : bytes]),
        size: bytes.length,
        contentRange: range ? `bytes ${range.start}-${range.end}/${bytes.length}` : undefined,
      }),
    ),
  };
  const annotation = (mutationId: string, deleted = false) => ({
    mutationId,
    quote: 'exact quote',
    note: '<untrusted note>',
    color: 'yellow',
    anchor: { version: 1, exact: 'exact quote' },
    deleted,
  });
  const native = (mutationId?: string) => ({
    document,
    progress: '/body/DocFragment[1]/body/p[1]/text().0',
    percentage: 0.75,
    device: 'KOReader',
    device_id: 'reader-1',
    ...(mutationId ? { mutationId } : {}),
  });
  const connection = () =>
    new DataSource({
      type: 'postgres',
      url,
      schema,
      extra: { options: `-c search_path=${schema},public` },
      namingStrategy: new SnakeNamingStrategy(),
      entities: [BookEntity, BookFormatEntity, BookShelfEntity, SavedPositionEntity, ...KOREADER_ENTITIES],
      synchronize: false,
    });

  beforeAll(async () => {
    admin = await new DataSource({ type: 'postgres', url }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    db = await connection().initialize();
    await db.query(`
      CREATE TABLE book_entity(id uuid PRIMARY KEY,title varchar NOT NULL,uploaded_by_user_id varchar,deleted_at timestamp);
      CREATE TABLE book_format_entity(id uuid PRIMARY KEY,book_id uuid NOT NULL REFERENCES book_entity(id),
        file_name varchar NOT NULL,format varchar NOT NULL,file_content_hash varchar);
      CREATE TABLE saved_position_entity(book_id uuid REFERENCES book_entity(id),user_id uuid,position varchar NOT NULL,
        device_name varchar NOT NULL,percentage double precision,created_at timestamp DEFAULT now(),
        updated_at timestamp DEFAULT now(),PRIMARY KEY(book_id,user_id));
    `);
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await new CreateKoreader1790000000011().up(runner);
      await new KoreaderVerifiedContent1790000000012().up(runner);
    } finally {
      await runner.release();
    }
    auth = new KoreaderAuthService(db, { cloudMode: false } as never);
    documents = new KoreaderDocumentService(
      db,
      auth,
      { assertAccess: jest.fn() } as never,
      storage as never,
      new ContentHashService(storage as never),
    );
    service = new KoreaderService(db, auth, documents);
    saved = new SavedPositionService(db.getRepository(SavedPositionEntity));
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
    storage.getFileStats.mockImplementation(() => Promise.resolve({ size: bytes.length, mtimeMs: 1 }));
    const zip = new AdmZip();
    zip.addFile('META-INF/container.xml', Buffer.from('<container><rootfile full-path="book.opf"/></container>'));
    zip.addFile('book.opf', Buffer.from(opf('Fixture')));
    zip.addFile('chapter.xhtml', Buffer.from('<p>exact quote</p>'));
    bytes = zip.toBuffer();
    await db.query(`TRUNCATE koreader_rate,koreader_alias,koreader_mutation,koreader_annotation,
      koreader_book_progress,koreader_native_progress,koreader_revision,koreader_pairing,koreader_device,
      saved_position_entity,book_format_entity,book_entity CASCADE`);
    await db.query(`INSERT INTO book_entity(id,title,uploaded_by_user_id) VALUES($1,'Fixture',$2)`, [book, user.id]);
    await db.query(`INSERT INTO book_format_entity(id,book_id,file_name,format) VALUES($1,$2,'fixture.epub','EPUB')`, [
      format,
      book,
    ]);
  });

  async function paired() {
    const pairing = await auth.createPairing({ deviceName: 'Reader' }, randomUUID());
    await auth.approve({ userCode: pairing.userCode }, user);
    const claim = await auth.claim({ deviceCode: pairing.deviceCode }, randomUUID());
    if (claim.state !== 'approved') throw new Error('Pairing did not approve');
    return { pairing, claim, actor: await auth.authenticate(claim.username, claim.key) };
  }

  test('atomically claims once and never persists a recoverable key or polling secret', async () => {
    const pairing = await auth.createPairing({ deviceName: 'Reader' }, 'single-use');
    await auth.approve({ userCode: pairing.userCode }, user);
    const claims = await Promise.allSettled([
      auth.claim({ deviceCode: pairing.deviceCode }, 'claim-1'),
      auth.claim({ deviceCode: pairing.deviceCode }, 'claim-2'),
    ]);
    expect(claims.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const accepted = claims.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<any>;
    expect(accepted.value.state).toBe('approved');
    const [row] = await db.query(`SELECT * FROM koreader_device`);
    expect(row.verifier).toBe(verifier(accepted.value.key));
    expect(JSON.stringify(row)).not.toContain(accepted.value.key);
    expect(JSON.stringify(await db.query(`SELECT * FROM koreader_pairing`))).not.toContain(pairing.deviceCode);
    await expect(auth.claim({ deviceCode: pairing.userCode }, 'human-code')).rejects.toThrow();
  });

  test('enforces poll interval, expiry, approval replay and durable request limits', async () => {
    const pairing = await auth.createPairing({ deviceName: 'Reader' }, 'expiry');
    expect(await auth.claim({ deviceCode: pairing.deviceCode }, 'poll')).toEqual({ state: 'pending' });
    await expect(auth.claim({ deviceCode: pairing.deviceCode }, 'poll')).rejects.toMatchObject({ status: 429 });
    await auth.approve({ userCode: pairing.userCode }, user);
    await expect(auth.approve({ userCode: pairing.userCode }, other)).rejects.toThrow();
    await db.query(`UPDATE koreader_pairing SET expires_at=now()-interval '1 second'`);
    await expect(auth.claim({ deviceCode: pairing.deviceCode }, 'expired')).rejects.toThrow();
    for (let i = 0; i < 5; i++) await auth.createPairing({ deviceName: 'Reader' }, 'rate');
    await expect(auth.createPairing({ deviceName: 'Reader' }, 'rate')).rejects.toMatchObject({ status: 429 });
  });

  test('authenticates scoped credentials and rejects writes authenticated before revocation', async () => {
    const { actor, claim } = await paired();
    await auth.revoke(user, actor.deviceId!);
    await expect(service.putAnnotation(actor, book, 'a1', annotation('op'))).rejects.toThrow();
    await expect(auth.authenticate(claim.username, claim.key)).rejects.toThrow();
    expect(await auth.devices(user)).toEqual([]);
    expect(await db.query(`SELECT * FROM koreader_annotation`)).toHaveLength(0);
  });

  test('serializes revocation with an already-running write and prevents every subsequent write', async () => {
    const { actor } = await paired();
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const first = db.transaction(async (manager) => {
      await auth.lockActor(manager, actor, true);
      locked();
      await gate;
    });
    await ready;
    let revoked = false;
    const revocation = auth.revoke(user, actor.deviceId!).then(() => {
      revoked = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(revoked).toBe(false);
    release();
    await Promise.all([first, revocation]);
    await expect(service.putNativeProgress(actor, native('revoked'))).rejects.toMatchObject({ status: 401 });
  });

  test('deduplicates accepted operations, emits tombstones, and keeps other users private even with ADMIN role', async () => {
    const created = await service.putAnnotation(user, book, 'a1', annotation('create'));
    expect(await service.putAnnotation(user, book, 'a1', annotation('create'))).toEqual(created);
    const deleted = await service.putAnnotation(user, book, 'a1', annotation('delete', true));
    expect(BigInt(deleted.revision)).toBe(BigInt(created.revision) + 1n);
    expect(await service.putAnnotation(user, book, 'a1', annotation('create'))).toEqual(created);
    const changes = await service.annotations(user, book, created.revision);
    expect(changes.items).toEqual([deleted]);
    expect(changes.items[0].deleted).toBe(true);
    expect((await service.annotations(other, book)).items).toEqual([]);
    await expect(
      service.putAnnotation(user, book, 'a1', { ...annotation('create'), note: 'different' }),
    ).rejects.toThrow();
    const restored = await service.putAnnotation(user, book, 'a1', annotation('offline-later'));
    expect(restored.deleted).toBe(false);
  });

  test('paginates without losing deletes and does not advance ordering for retries', async () => {
    for (let i = 1; i <= 102; i++) await service.putAnnotation(user, book, `a${i}`, annotation(`op${i}`, i % 2 === 0));
    const first = await service.annotations(user, book);
    expect(first.items).toHaveLength(100);
    expect(first.hasMore).toBe(true);
    const next = await service.annotations(user, book, first.cursor);
    expect(next.items).toHaveLength(2);
    expect(next.hasMore).toBe(false);
    const retry = await service.putAnnotation(user, book, 'a1', annotation('op1'));
    expect(retry.revision).toBe('1');
    expect((await service.annotations(user, book, next.cursor)).items).toEqual([]);
  });

  test('holds revision allocation until commit so a cursor cannot skip an earlier uncommitted mutation', async () => {
    let release!: () => void;
    let locked!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const first = db.transaction(async (manager) => {
      await lockSyncUser(manager, user.id);
      const revision = await nextSyncRevision(manager, user.id);
      locked();
      await gate;
      return revision;
    });
    await ready;
    let finished = false;
    const later = service.putAnnotation(user, book, 'later', annotation('later')).then((value) => {
      finished = true;
      return value;
    });
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(finished).toBe(false);
    release();
    expect(await first).toBe('1');
    expect((await later).revision).toBe('2');
    expect((await service.annotations(user, book, '1')).items).toHaveLength(1);
  });

  test('keeps raw native pointers separate and lets web saves win without retry feedback', async () => {
    const link = jest
      .spyOn(documents, 'linked')
      .mockResolvedValue({ bookId: book, formatId: format, title: 'Fixture' });
    try {
      const pushed = await service.putNativeProgress(user, native('native-1'));
      const old = await service.getNativeProgress(user, document);
      expect(old).toMatchObject({ percentage: 0.75, progress: native().progress, timestamp: pushed.timestamp });
      expect((await service.progress(user, book))?.source).toBe('koreader');
      await saved.save({
        bookId: book,
        userId: user.id,
        position: '{"href":"chapter.xhtml"}',
        deviceName: 'Web',
        percentage: 0.2,
      });
      const latest = await service.progress(user, book);
      expect(latest).toMatchObject({ source: 'web', percentage: 0.2, revision: '2' });
      expect(latest).not.toHaveProperty('nativeProgress');
      const { actor } = await paired();
      expect(await service.progress(actor, book)).toMatchObject({
        source: 'web',
        accuracy: 'approximate',
        percentage: 0.2,
      });
      expect(await service.putNativeProgress(user, native('native-1'))).toEqual(pushed);
      expect((await service.progress(user, book))?.source).toBe('web');
      expect(await service.getNativeProgress(user, document)).toEqual(old);
      await service.putNativeProgress(user, { ...native('native-2'), percentage: 0.1 });
      expect((await service.progress(user, book))?.percentage).toBe(0.1);
    } finally {
      link.mockRestore();
    }
  });

  test('offers pre-integration web positions without inventing a native anchor', async () => {
    await db.getRepository(SavedPositionEntity).save({
      bookId: book,
      userId: user.id,
      position: 'legacy-web-locator',
      deviceName: 'Existing web reader',
      percentage: 0.6,
    });
    expect(await service.progress(user, book)).toMatchObject({
      percentage: 0.6,
      source: 'web',
      accuracy: 'exact',
      revision: '0',
      device: 'Existing web reader',
    });
    expect(await service.progress(user, book)).not.toHaveProperty('nativeProgress');
    expect(await service.getNativeProgress(user, document)).toEqual({});
    await documents.resolve(user, { document: partialMd5(bytes) });
    expect(await service.progress(user, book)).toMatchObject({ source: 'web', percentage: 0.6, revision: '0' });
  });

  test('returns empty native state and persists unresolved progress across a new connection', async () => {
    expect(await service.getNativeProgress(user, document)).toEqual({});
    await service.putNativeProgress(user, native());
    const reopened = await connection().initialize();
    try {
      const [row] = await reopened.query(`SELECT payload FROM koreader_native_progress WHERE user_id=$1`, [user.id]);
      expect(row.payload.progress).toBe(native().progress);
    } finally {
      await reopened.destroy();
    }
  });

  test('does not promote older raw progress when the document is linked after a newer web save', async () => {
    const hash = partialMd5(bytes);
    await service.putNativeProgress(user, { ...native('before-link'), document: hash });
    await saved.save({ bookId: book, userId: user.id, position: 'web-locator', deviceName: 'Web', percentage: 0.3 });
    await documents.resolve(user, { document: hash });
    expect(await service.progress(user, book)).toMatchObject({ source: 'web', percentage: 0.3, revision: '2' });
    await service.putNativeProgress(user, { ...native('after-link'), document: hash, percentage: 0.2 });
    expect(await service.progress(user, book)).toMatchObject({ source: 'koreader', percentage: 0.2, revision: '3' });
    await saved.save({ bookId: book, userId: user.id, position: 'another-web-locator', deviceName: 'Web' });
    expect(await service.progress(user, book)).toBeNull();
    await saved.delete(book, user.id);
    await documents.resolve(user, { document: hash });
    expect(await service.progress(user, book)).toBeNull();
  });

  test('expired bindings cannot authenticate or write using a previously authenticated actor', async () => {
    const { claim, actor } = await paired();
    await db.query(`UPDATE koreader_device SET expires_at=now()-interval '1 second' WHERE id=$1`, [claim.deviceId]);
    await expect(auth.authenticate(claim.username, claim.key)).rejects.toMatchObject({ status: 401 });
    await expect(service.putNativeProgress(actor, native('expired'))).rejects.toMatchObject({ status: 401 });
  });

  test('verifies EPUB aliases, rejects collisions, and does not enumerate another tenant', async () => {
    const hash = partialMd5(bytes);
    expect(await documents.resolve(user, { document: hash })).toMatchObject({ bookId: book, formatId: format });
    const duplicateBook = randomUUID();
    const duplicateFormat = randomUUID();
    await db.query(`INSERT INTO book_entity(id,title,uploaded_by_user_id) VALUES($1,'Other tenant',$2)`, [
      duplicateBook,
      other.id,
    ]);
    await db.query(`INSERT INTO book_format_entity(id,book_id,file_name,format) VALUES($1,$2,'copy.epub','EPUB')`, [
      duplicateFormat,
      duplicateBook,
    ]);
    await expect(documents.resolve(user, { document: hash })).rejects.toMatchObject({ status: 409 });
    process.env.CLOUD_MODE = 'true';
    expect(await documents.resolve(user, { document: hash })).toMatchObject({ bookId: book });
    await expect(service.annotations({ id: randomUUID(), roles: [] }, book)).rejects.toMatchObject({ status: 404 });
    await expect(documents.resolve(user, { document: 'f'.repeat(32) })).rejects.toMatchObject({ status: 404 });
  });

  test('retains aliases for metadata-only rewrites but invalidates actual edition replacements', async () => {
    const original = partialMd5(bytes);
    await documents.resolve(user, { document: original });
    const zip = new AdmZip(bytes);
    zip.updateFile('book.opf', Buffer.from(opf('Updated')));
    bytes = zip.toBuffer();
    storage.getFileStats.mockImplementation(() => Promise.resolve({ size: bytes.length, mtimeMs: 2 }));
    expect(await documents.resolve(user, { document: original })).toMatchObject({ bookId: book });
    expect(await documents.resolve(user, { document: partialMd5(bytes) })).toMatchObject({ bookId: book });
    zip.updateFile('chapter.xhtml', Buffer.from('<p>Replacement edition</p>'));
    bytes = zip.toBuffer();
    storage.getFileStats.mockImplementation(() => Promise.resolve({ size: bytes.length, mtimeMs: 3 }));
    await expect(documents.resolve(user, { document: original })).rejects.toMatchObject({ status: 404 });
    expect(await documents.resolve(user, { document: partialMd5(bytes) })).toMatchObject({ bookId: book });
  });

  test('verifies supplied spine SHA-256 and aliases an older reader file after a metadata rewrite', async () => {
    const oldDocument = partialMd5(bytes);
    const contentHash = new ContentHashService(storage as never).computeHashFromBuffer(bytes, 'fixture.epub');
    const zip = new AdmZip(bytes);
    zip.updateFile('book.opf', Buffer.from(opf('Rewritten before first pairing')));
    bytes = zip.toBuffer();
    expect(partialMd5(bytes)).not.toBe(oldDocument);
    expect(await documents.resolve(user, { document: oldDocument, contentHash })).toMatchObject({
      bookId: book,
      formatId: format,
    });
    await service.putNativeProgress(user, { ...native('spine-verified'), document: oldDocument });
    expect(await service.progress(user, book)).toMatchObject({ source: 'koreader', percentage: 0.75 });
    await expect(
      documents.resolve(user, { document: partialMd5(bytes), contentHash: 'f'.repeat(64) }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test('rejects a conflicting canonical hash on an already-linked sparse checksum collision', async () => {
    const collisionEpub = (letter: string) => {
      const zip = new AdmZip();
      zip.addFile('000-padding.bin', Buffer.alloc(20000, 120));
      zip.addFile('META-INF/container.xml', Buffer.from('<container><rootfile full-path="book.opf"/></container>'));
      zip.addFile('book.opf', Buffer.from(opf('Sparse collision fixture')));
      zip.addFile('chapter.xhtml', Buffer.from(`<p>${letter}${'x'.repeat(50000)}</p>`));
      for (const entry of zip.getEntries()) entry.header.method = 0;
      return zip.toBuffer();
    };
    bytes = collisionEpub('A');
    const document = partialMd5(bytes);
    const hashes = new ContentHashService(storage as never);
    const originalHash = hashes.computeHashFromBuffer(bytes, 'fixture.epub');
    let etag = 'first';
    storage.getFileStats.mockImplementation(() => Promise.resolve({ size: bytes.length, mtimeMs: 1, etag }));
    await documents.resolve(user, { document, contentHash: originalHash });
    const originalSize = bytes.length;
    bytes = collisionEpub('B');
    etag = 'second';
    expect(bytes.length).toBe(originalSize);
    expect(partialMd5(bytes)).toBe(document);
    const replacementHash = hashes.computeHashFromBuffer(bytes, 'fixture.epub');
    expect(replacementHash).not.toBe(originalHash);
    await expect(documents.resolve(user, { document, contentHash: originalHash })).rejects.toMatchObject({
      status: 404,
    });
    expect(await documents.resolve(user, { document, contentHash: replacementHash })).toMatchObject({ bookId: book });
  });

  test('requires explicit verified format selection when content identity is ambiguous', async () => {
    const hash = partialMd5(bytes);
    const contentHash = new ContentHashService(storage as never).computeHashFromBuffer(bytes, 'fixture.epub');
    const secondBook = randomUUID();
    const secondFormat = randomUUID();
    await db.query(`INSERT INTO book_entity(id,title,uploaded_by_user_id) VALUES($1,'Verified copy',$2)`, [
      secondBook,
      other.id,
    ]);
    await db.query(`INSERT INTO book_format_entity(id,book_id,file_name,format) VALUES($1,$2,'copy.epub','EPUB')`, [
      secondFormat,
      secondBook,
    ]);
    await expect(documents.resolve(user, { document: hash, contentHash })).rejects.toMatchObject({ status: 409 });
    await expect(documents.resolve(user, { document: hash, formatId: secondFormat })).rejects.toMatchObject({
      status: 400,
    });
    expect(await documents.resolve(user, { document: hash, contentHash, formatId: secondFormat })).toMatchObject({
      bookId: secondBook,
      formatId: secondFormat,
    });
    await service.putNativeProgress(user, { ...native('selected-format'), document: hash });
    expect(await service.progress(user, secondBook)).toMatchObject({ source: 'koreader' });
    expect(await service.progress(user, book)).toBeNull();
    process.env.CLOUD_MODE = 'true';
    await expect(
      documents.resolve(user, { document: hash, contentHash, formatId: secondFormat }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await documents.resolve(user, { document: hash, contentHash, formatId: format })).toMatchObject({
      bookId: book,
    });
  });

  test('commits bounded resumable indexing work instead of loading the whole library', async () => {
    const books = Array.from({ length: 32 }, () => randomUUID());
    const formats = books.map(() => randomUUID());
    await db.query(
      `INSERT INTO book_entity(id,title,uploaded_by_user_id)
      SELECT value,'Page fixture',$2 FROM unnest($1::uuid[]) value`,
      [books, user.id],
    );
    await db.query(
      `INSERT INTO book_format_entity(id,book_id,file_name,format)
      SELECT f,b,f::text||'.epub','EPUB' FROM unnest($1::uuid[],$2::uuid[]) AS rows(f,b)`,
      [formats, books],
    );
    await expect(documents.resolve(user, { document: 'f'.repeat(32) })).rejects.toMatchObject({ status: 503 });
    expect((await db.query(`SELECT count(*)::int AS count FROM koreader_alias`))[0].count).toBe(32);
    await expect(documents.resolve(user, { document: 'f'.repeat(32) })).rejects.toMatchObject({ status: 404 });
    expect((await db.query(`SELECT count(*)::int AS count FROM koreader_alias`))[0].count).toBe(33);
    expect(
      (await db.query(`SELECT scan_after FROM koreader_revision WHERE user_id=$1`, [user.id]))[0].scan_after,
    ).toBeNull();
  });

  test('migration rolls back and reapplies without schema synchronization', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      const migration = new CreateKoreader1790000000011();
      const verified = new KoreaderVerifiedContent1790000000012();
      await verified.down(runner);
      await migration.down(runner);
      expect(await db.query(`SELECT to_regclass('koreader_device') AS relation`)).toEqual([{ relation: null }]);
      await migration.up(runner);
      await verified.up(runner);
      expect(await db.query(`SELECT count(*)::int AS count FROM koreader_device`)).toEqual([{ count: 0 }]);
    } finally {
      await runner.release();
    }
  });
});
