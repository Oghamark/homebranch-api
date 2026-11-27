import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream } from 'fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { isCloudMode } from 'src/common/utils/cloud';
import { StorageQuotaService } from '../cloud/storage-quota.service';
import { UploadFileDto } from './upload-session.dto';

export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const SESSION_LIFETIME = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type UploadSession = { userId: string; files: UploadFileDto[]; expiresAt: number };
export type UploadedFile = { path: string; originalname: string };

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

@Injectable()
export class UploadSessionService {
  private readonly logger = new Logger(UploadSessionService.name);
  private readonly root: string;

  constructor(
    config: ConfigService,
    private readonly quota: StorageQuotaService,
  ) {
    this.root = join(config.get<string>('UPLOADS_DIRECTORY', './uploads'), '.upload-sessions');
  }

  async create(userId: string, files: UploadFileDto[]) {
    if (
      !Array.isArray(files) ||
      files.length < 1 ||
      files.length > 500 ||
      files.some(
        (file) =>
          typeof file.name !== 'string' ||
          Buffer.byteLength(file.name) > 255 ||
          /[/\\\0]/.test(file.name) ||
          !['.epub', '.pdf', '.mp3', '.m4b'].includes(extname(file.name).toLowerCase()) ||
          !Number.isSafeInteger(file.size) ||
          file.size < 0,
      )
    ) {
      throw new BadRequestException('Invalid upload files');
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (!Number.isSafeInteger(totalBytes)) throw new BadRequestException('Invalid upload size');
    if (isCloudMode()) await this.quota.assertCanStore(userId, totalBytes);
    const uploadId = randomUUID();
    const directory = this.directory(uploadId);
    const expiresAt = Date.now() + SESSION_LIFETIME;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(join(directory, 'session.json'), JSON.stringify({ userId, files, expiresAt }), {
        flag: 'wx',
        mode: 0o600,
      });
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
    return { uploadId, chunkSize: UPLOAD_CHUNK_SIZE, expiresAt };
  }

  async putChunk(userId: string, uploadId: string, fileIndex: number, chunkIndex: number, chunk: Buffer) {
    return this.withSession(userId, uploadId, async (session, directory) => {
      const file = session.files[fileIndex];
      const count = file ? Math.ceil(file.size / UPLOAD_CHUNK_SIZE) : 0;
      if (
        !Number.isSafeInteger(fileIndex) ||
        fileIndex < 0 ||
        !file ||
        !Number.isSafeInteger(chunkIndex) ||
        chunkIndex < 0 ||
        chunkIndex >= count
      )
        throw new BadRequestException('Invalid upload chunk index');
      const expectedSize = Math.min(UPLOAD_CHUNK_SIZE, file.size - chunkIndex * UPLOAD_CHUNK_SIZE);
      if (chunk.length !== expectedSize) throw new BadRequestException('Invalid upload chunk size');
      const chunkDirectory = join(directory, 'chunks', String(fileIndex));
      await mkdir(chunkDirectory, { recursive: true });
      const path = join(chunkDirectory, String(chunkIndex));
      try {
        if (!(await readFile(path)).equals(chunk)) {
          throw new ConflictException('This chunk was already uploaded with different content');
        }
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) throw error;
        const temporary = join(chunkDirectory, `${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, chunk, { flag: 'wx', mode: 0o600 });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      return { received: true };
    });
  }

  async consume<T>(userId: string, uploadId: string, processFiles: (files: UploadedFile[]) => Promise<T>): Promise<T> {
    return this.withSession(userId, uploadId, async (session, directory) => {
      try {
        const files: UploadedFile[] = [];
        for (const [fileIndex, file] of session.files.entries()) {
          const fileDirectory = join(directory, 'files', String(fileIndex));
          await mkdir(fileDirectory, { recursive: true });
          const path = join(fileDirectory, file.name);
          await writeFile(path, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
          for (let chunkIndex = 0; chunkIndex < Math.ceil(file.size / UPLOAD_CHUNK_SIZE); chunkIndex++) {
            const chunkPath = join(directory, 'chunks', String(fileIndex), String(chunkIndex));
            let size: number;
            try {
              size = (await stat(chunkPath)).size;
            } catch (error) {
              if (!hasCode(error, 'ENOENT')) throw error;
              throw new BadRequestException('Upload is incomplete. Please retry the upload.');
            }
            if (size !== Math.min(UPLOAD_CHUNK_SIZE, file.size - chunkIndex * UPLOAD_CHUNK_SIZE)) {
              throw new BadRequestException('Invalid upload chunk size');
            }
            await pipeline(createReadStream(chunkPath), createWriteStream(path, { flags: 'a' }));
          }
          files.push({ path, originalname: file.name });
        }
        return await processFiles(files);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  async cancel(userId: string, uploadId: string): Promise<void> {
    await this.withSession(userId, uploadId, async (_session, directory) => {
      await rm(directory, { recursive: true, force: true });
    });
  }

  @Cron('0 * * * *')
  async cleanExpired(): Promise<void> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (error) {
      if (hasCode(error, 'ENOENT')) return;
      throw error;
    }
    for (const uploadId of entries.filter((entry) => UUID.test(entry))) {
      const directory = this.directory(uploadId);
      try {
        if ((await stat(join(directory, 'session.json'))).mtimeMs > Date.now() - SESSION_LIFETIME) continue;
        try {
          if ((await stat(join(directory, 'lock'))).mtimeMs > Date.now() - SESSION_LIFETIME) continue;
        } catch (error) {
          if (!hasCode(error, 'ENOENT')) throw error;
        }
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) this.logger.error(`Failed to clean upload session ${uploadId}`, error);
      }
    }
  }

  private directory(uploadId: string): string {
    if (!UUID.test(uploadId)) throw new BadRequestException('Invalid upload session');
    return join(this.root, uploadId.toLowerCase());
  }

  private async withSession<T>(
    userId: string,
    uploadId: string,
    operation: (session: UploadSession, directory: string) => Promise<T>,
  ): Promise<T> {
    const directory = this.directory(uploadId);
    let session: UploadSession;
    try {
      session = JSON.parse(await readFile(join(directory, 'session.json'), 'utf8')) as UploadSession;
    } catch (error) {
      if (hasCode(error, 'ENOENT')) throw new NotFoundException('Upload session not found');
      throw error;
    }
    if (session.userId !== userId) throw new NotFoundException('Upload session not found');
    if (session.expiresAt <= Date.now()) throw new BadRequestException('Upload session expired. Please retry.');
    let lock: Awaited<ReturnType<typeof open>>;
    try {
      lock = await open(join(directory, 'lock'), 'wx', 0o600);
    } catch (error) {
      if (hasCode(error, 'EEXIST')) throw new ConflictException('Upload session is busy');
      if (hasCode(error, 'ENOENT')) throw new NotFoundException('Upload session not found');
      throw error;
    }
    try {
      return await operation(session, directory);
    } finally {
      await lock.close();
      try {
        await unlink(join(directory, 'lock'));
      } catch (error) {
        if (!hasCode(error, 'ENOENT')) this.logger.error(`Failed to release upload session ${uploadId}`, error);
      }
    }
  }
}
