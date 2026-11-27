import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'crypto';
import { createReadStream } from 'fs';
import { mkdtemp, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BookCreationService } from 'src/modules/book/catalog/book-creation.service';
import { UploadedBooksController } from 'src/modules/book/catalog/uploaded-books.controller';
import { StorageQuotaService } from 'src/modules/cloud/storage-quota.service';
import { UploadSessionController } from 'src/modules/uploads/upload-session.controller';
import { UPLOAD_CHUNK_SIZE, UploadSessionService } from 'src/modules/uploads/upload-session.service';

describe('chunk upload HTTP API', () => {
  let app: INestApplication;
  let directory: string;
  const owner = randomUUID();
  const books = { createBook: jest.fn(), createAudiobook: jest.fn(), previewAudiobook: jest.fn() };
  const previousCloud = process.env.CLOUD_MODE;

  beforeAll(async () => {
    process.env.CLOUD_MODE = 'false';
    directory = await mkdtemp(join(tmpdir(), 'homebranch-chunks-http-'));
    const module = await Test.createTestingModule({
      controllers: [UploadSessionController, UploadedBooksController],
      providers: [
        UploadSessionService,
        { provide: ConfigService, useValue: new ConfigService({ UPLOADS_DIRECTORY: directory }) },
        { provide: StorageQuotaService, useValue: { assertCanStore: jest.fn() } },
        { provide: BookCreationService, useValue: books },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<{ headers: Record<string, string>; user?: Express.User }>();
          const id = req.headers['x-test-user'];
          if (!id) return false;
          req.user = { id, email: 'test@example.invalid', roles: ['USER'] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, stopAtFirstError: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
    process.env.CLOUD_MODE = previousCloud;
  });

  it('uploads a 186.4 MiB file through small requests and passes exact bytes to book ingestion', async () => {
    const size = Math.floor(186.4 * 1024 * 1024);
    const expectedHash = createHash('sha256');
    const session = await request(app.getHttpServer())
      .post('/upload-sessions')
      .set('x-test-user', owner)
      .send({ files: [{ name: 'Large audiobook.m4b', size }] })
      .expect(201);
    const { uploadId, chunkSize } = session.body as { uploadId: string; chunkSize: number };
    expect(chunkSize).toBeLessThan(100 * 1024 * 1024);
    for (let offset = 0, index = 0; offset < size; offset += chunkSize, index++) {
      const chunk = Buffer.alloc(Math.min(chunkSize, size - offset), index);
      expectedHash.update(chunk);
      await request(app.getHttpServer())
        .put(`/upload-sessions/${uploadId}/files/0/chunks/${index}`)
        .set('x-test-user', owner)
        .attach('chunk', chunk, 'chunk')
        .expect(200);
    }
    books.createBook.mockImplementationOnce(async ({ filePath }: { filePath: string }) => {
      expect((await stat(filePath)).size).toBe(size);
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(filePath)) {
        if (!Buffer.isBuffer(chunk)) throw new Error('Invalid file data');
        hash.update(chunk);
      }
      expect(hash.digest('hex')).toBe(expectedHash.digest('hex'));
      return { id: 'book' };
    });
    const response = await request(app.getHttpServer())
      .post('/books/from-upload')
      .set('x-test-user', owner)
      .send({
        uploadId,
        title: 'Large audiobook',
        author: 'Author',
        isFavorite: false,
        filePath: '/etc/passwd',
        uploadedByUserId: 'other',
      })
      .expect(201);
    expect(response.body).toEqual({ id: 'book' });
    expect(books.createBook).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Large audiobook',
        author: 'Author',
        isFavorite: false,
        uploadedByUserId: owner,
      }),
    );
    expect(books.createBook.mock.calls[0][0].filePath).not.toBe('/etc/passwd');
    await expect(stat(join(directory, '.upload-sessions', uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 60000);

  it('requires authentication and validates manifests and multipart chunk limits', async () => {
    await request(app.getHttpServer())
      .post('/upload-sessions')
      .send({ files: [{ name: 'Story.m4b', size: 3 }] })
      .expect(403);
    await request(app.getHttpServer())
      .post('/upload-sessions')
      .set('x-test-user', owner)
      .send({ files: [{ name: 'Story.m4b', size: -1 }] })
      .expect(400);
    const session = await request(app.getHttpServer())
      .post('/upload-sessions')
      .set('x-test-user', owner)
      .send({ files: [{ name: 'Story.m4b', size: UPLOAD_CHUNK_SIZE + 1 }] })
      .expect(201);
    const { uploadId } = session.body as { uploadId: string };
    await request(app.getHttpServer())
      .put(`/upload-sessions/${uploadId}/files/0/chunks/0`)
      .set('x-test-user', randomUUID())
      .attach('chunk', Buffer.alloc(UPLOAD_CHUNK_SIZE), 'chunk')
      .expect(404);
    await request(app.getHttpServer())
      .put(`/upload-sessions/${uploadId}/files/0/chunks/0`)
      .set('x-test-user', owner)
      .attach('chunk', Buffer.alloc(UPLOAD_CHUNK_SIZE + 1), 'chunk')
      .expect(413);
    await request(app.getHttpServer()).delete(`/upload-sessions/${uploadId}`).set('x-test-user', owner).expect(204);
  });

  it('preserves audiobook track order and preview paths without a large multipart request', async () => {
    for (const preview of [true, false]) {
      const session = await request(app.getHttpServer())
        .post('/upload-sessions')
        .set('x-test-user', owner)
        .send({
          files: [
            { name: 'two.mp3', size: 3 },
            { name: 'one.mp3', size: 3 },
          ],
        })
        .expect(201);
      const { uploadId } = session.body as { uploadId: string };
      for (let index = 0; index < 2; index++) {
        await request(app.getHttpServer())
          .put(`/upload-sessions/${uploadId}/files/${index}/chunks/0`)
          .set('x-test-user', owner)
          .attach('chunk', Buffer.from('abc'), 'chunk')
          .expect(200);
      }
      books.previewAudiobook.mockResolvedValue([]);
      books.createAudiobook.mockResolvedValue({ id: 'audio' });
      await request(app.getHttpServer())
        .post(preview ? '/books/audiobook/preview-from-upload' : '/books/audiobook/from-upload')
        .set('x-test-user', owner)
        .send(
          preview
            ? { uploadId, relativePaths: ['Folder/two.mp3', 'Folder/one.mp3'] }
            : { uploadId, title: 'Audio', author: 'Author' },
        )
        .expect(201);
      const call = (preview ? books.previewAudiobook : books.createAudiobook).mock.calls[0];
      expect(call[0].map((file: { originalname: string }) => file.originalname)).toEqual(['two.mp3', 'one.mp3']);
      if (preview) expect(call[1]).toEqual(['Folder/two.mp3', 'Folder/one.mp3']);
      else expect(call.slice(1)).toEqual(['Audio', 'Author', owner]);
    }
  });
});
