import { INestApplication, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { readFile, stat } from 'fs/promises';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { JwtStrategy } from 'src/modules/auth/strategies/jwt.strategy';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookService } from 'src/modules/book/catalog/book.service';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { ContentHashService } from 'src/modules/book/format/content-hash.service';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { EntitlementService } from 'src/modules/cloud/entitlement.service';
import { KoreaderAuthService } from 'src/modules/koreader/koreader-auth.service';
import {
  KoreaderExtensionController,
  KoreaderNativeController,
  KoreaderPairingController,
} from 'src/modules/koreader/koreader.controller';
import { KoreaderDocumentService } from 'src/modules/koreader/koreader-document.service';
import { KOREADER_ENTITIES } from 'src/modules/koreader/koreader.entity';
import { KoreaderDeviceGuard, KoreaderSyncGuard } from 'src/modules/koreader/koreader.guard';
import { KoreaderService } from 'src/modules/koreader/koreader.service';
import { partialMd5 } from 'src/modules/koreader/partial-md5';
import { SavedPositionController } from 'src/modules/saved-position/saved-position.controller';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { STORAGE_SERVICE_TOKEN } from 'src/modules/storage/storage.interface';
import { StorageByteRange } from 'src/modules/storage/storage.types';
import { CreateKoreader1790000000011 } from 'src/migrations/1790000000011-CreateKoreader';
import { KoreaderVerifiedContent1790000000012 } from 'src/migrations/1790000000012-KoreaderVerifiedContent';

/** Local-only synthetic integration fixture. Never imports or starts the production application. */
export async function startKoreaderHarness() {
  const url = process.env.KOREADER_TEST_DATABASE_URL;
  const fixture = process.env.KOREADER_FIXTURE_PATH;
  const jwtSecret =
    process.env.KOREADER_TEST_JWT_SECRET ?? (process.send ? randomBytes(32).toString('hex') : undefined);
  if (!url || !fixture || !jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      'Set KOREADER_TEST_DATABASE_URL, KOREADER_FIXTURE_PATH, and a 32+ character KOREADER_TEST_JWT_SECRET',
    );
  }
  const tlsKey = process.env.KOREADER_TEST_TLS_KEY;
  const tlsCert = process.env.KOREADER_TEST_TLS_CERT;
  if (Boolean(tlsKey) !== Boolean(tlsCert)) throw new Error('Both test TLS key and certificate are required');
  const buffer = await readFile(fixture);
  if (buffer.length > 32 * 1024 * 1024) throw new Error('Fixture exceeds harness size limit');
  process.env.JWT_ACCESS_SECRET = jwtSecret;
  process.env.CLOUD_MODE = 'false';
  process.env.NODE_ENV = 'test';
  const schema = `koreader_live_${randomUUID().replaceAll('-', '')}`;
  const userId = randomUUID();
  const bookId = randomUUID();
  const formatId = randomUUID();
  const admin = await new DataSource({ type: 'postgres', url }).initialize();
  const db = new DataSource({
    type: 'postgres',
    url,
    schema,
    extra: { options: `-c search_path=${schema},public` },
    entities: [BookEntity, BookFormatEntity, BookShelfEntity, SavedPositionEntity, ...KOREADER_ENTITIES],
    namingStrategy: new SnakeNamingStrategy(),
    synchronize: false,
  });
  let app: INestApplication | undefined;
  const cleanup = async () => {
    await app?.close();
    if (db.isInitialized) await db.destroy();
    if (admin.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  };
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await db.initialize();
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
    const storage = {
      getFileStats: async (key: string) => {
        if (key !== 'books/fixture.epub') throw new NotFoundException();
        const file = await stat(fixture);
        return { size: file.size, mtimeMs: file.mtimeMs };
      },
      getFileStream: async (key: string, range?: StorageByteRange) => {
        if (key !== 'books/fixture.epub') throw new NotFoundException();
        const file = await stat(fixture);
        return {
          stream: createReadStream(fixture, range),
          mimeType: 'application/epub+zip',
          size: file.size,
          contentRange: range ? `bytes ${range.start}-${range.end}/${file.size}` : undefined,
        };
      },
    };
    const hashes = new ContentHashService(storage as never);
    const contentHash = hashes.computeHashFromBuffer(buffer, 'fixture.epub');
    await db.query(`INSERT INTO book_entity(id,title,uploaded_by_user_id) VALUES($1,'Native fixture',$2)`, [
      bookId,
      userId,
    ]);
    await db.query(
      `INSERT INTO book_format_entity(id,book_id,file_name,format,file_content_hash)
      VALUES($1,$2,'fixture.epub','EPUB',$3)`,
      [formatId, bookId, contentHash],
    );
    const module = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), PassportModule],
      controllers: [
        KoreaderPairingController,
        KoreaderNativeController,
        KoreaderExtensionController,
        SavedPositionController,
      ],
      providers: [
        JwtStrategy,
        JwtAuthGuard,
        KoreaderDeviceGuard,
        KoreaderSyncGuard,
        KoreaderAuthService,
        KoreaderDocumentService,
        KoreaderService,
        SavedPositionService,
        { provide: DataSource, useValue: db },
        { provide: EntitlementService, useValue: { cloudMode: false } },
        { provide: BookService, useValue: { assertAccess: () => Promise.resolve() } },
        { provide: STORAGE_SERVICE_TOKEN, useValue: storage },
        { provide: ContentHashService, useValue: hashes },
        { provide: getRepositoryToken(SavedPositionEntity), useValue: db.getRepository(SavedPositionEntity) },
      ],
    }).compile();
    const httpsOptions =
      tlsKey && tlsCert
        ? {
            key: await readFile(tlsKey),
            cert: await readFile(tlsCert),
            ...(process.env.KOREADER_TEST_TLS_PASSPHRASE
              ? { passphrase: process.env.KOREADER_TEST_TLS_PASSPHRASE }
              : {}),
          }
        : undefined;
    app = module.createNestApplication({ logger: false, ...(httpsOptions ? { httpsOptions } : {}) });
    await app.listen(Number(process.env.KOREADER_TEST_PORT ?? 0), '127.0.0.1');
    const apiUrl = await app.getUrl();
    const approve = async (userCode: string) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const signing = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
        sub: userId,
        email: 'synthetic@example.test',
        roles: [],
        exp: Math.floor(Date.now() / 1000) + 60,
      })}`;
      const token = `${signing}.${createHmac('sha256', jwtSecret).update(signing).digest('base64url')}`;
      const response = await fetch(`${apiUrl}/koreader/pairings/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ userCode }),
        signal: AbortSignal.timeout(5000),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('Synthetic browser approval failed');
    };
    return {
      app,
      db,
      cleanup,
      approve,
      info: {
        url: apiUrl,
        userId,
        bookId,
        formatId,
        document: partialMd5(buffer),
        contentHash,
        schema,
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

if (require.main === module) {
  void startKoreaderHarness()
    .then(({ cleanup, approve, info }) => {
      if (process.send) process.send({ type: 'ready', ...info });
      else console.log(JSON.stringify(info));
      let closing = false;
      const configuredDuration = Number(process.env.KOREADER_TEST_MAX_DURATION_MS ?? 300000);
      const duration = Number.isFinite(configuredDuration)
        ? Math.min(900000, Math.max(1000, configuredDuration))
        : 300000;
      const timer = setTimeout(() => close(), duration);
      const close = () => {
        if (closing) return;
        closing = true;
        clearTimeout(timer);
        void cleanup().then(
          () => process.exit(0),
          () => process.exit(1),
        );
      };
      process.once('SIGINT', close);
      process.once('SIGTERM', close);
      process.once('disconnect', close);
      process.on('message', (value: unknown) => {
        if (!value || typeof value !== 'object') return;
        const message = value as Record<string, unknown>;
        if (message.type === 'shutdown') {
          close();
          return;
        }
        if (
          message.type !== 'approve' ||
          typeof message.requestId !== 'string' ||
          typeof message.userCode !== 'string' ||
          message.userCode.length > 32
        )
          return;
        const requestId = message.requestId;
        void approve(message.userCode).then(
          () => {
            if (process.connected) process.send?.({ type: 'approved', requestId, state: 'approved' });
          },
          () => {
            if (process.connected)
              process.send?.({ type: 'error', requestId, message: 'Synthetic browser approval failed' });
          },
        );
      });
    })
    .catch(() => {
      console.error('KOReader isolated harness failed; verify fixture, test database and TLS configuration');
      process.exitCode = 1;
    });
}
