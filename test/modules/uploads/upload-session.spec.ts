import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, stat, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { StorageQuotaService } from 'src/modules/cloud/storage-quota.service';
import { UPLOAD_CHUNK_SIZE, UploadSessionService } from 'src/modules/uploads/upload-session.service';

describe('chunk upload sessions', () => {
  let directory: string;
  let service: UploadSessionService;
  let config: ConfigService;
  const quota = { assertCanStore: jest.fn() };
  const previousCloud = process.env.CLOUD_MODE;

  beforeEach(async () => {
    process.env.CLOUD_MODE = 'false';
    directory = await mkdtemp(join(tmpdir(), 'homebranch-chunks-test-'));
    config = new ConfigService({ UPLOADS_DIRECTORY: directory });
    service = new UploadSessionService(config, quota as unknown as StorageQuotaService);
    quota.assertCanStore.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    process.env.CLOUD_MODE = previousCloud;
    await rm(directory, { recursive: true, force: true });
  });

  it('reassembles exact bytes across restarts and accepts an identical retried chunk', async () => {
    const first = Buffer.alloc(UPLOAD_CHUNK_SIZE, 42);
    const last = Buffer.from('end');
    const { uploadId } = await service.create('alice', [{ name: 'Story.m4b', size: first.length + last.length }]);
    await service.putChunk('alice', uploadId, 0, 0, first);
    await service.putChunk('alice', uploadId, 0, 0, first);
    await expect(service.putChunk('alice', uploadId, 0, 0, Buffer.alloc(first.length, 43))).rejects.toBeInstanceOf(
      ConflictException,
    );
    service = new UploadSessionService(config, quota as unknown as StorageQuotaService);
    await service.putChunk('alice', uploadId, 0, 1, last);
    const result = await service.consume('alice', uploadId, async (files) => {
      expect(files[0].originalname).toBe('Story.m4b');
      expect((await readFile(files[0].path)).equals(Buffer.concat([first, last]))).toBe(true);
      return 'book';
    });
    expect(result).toBe('book');
    await expect(stat(join(directory, '.upload-sessions', uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects wrong owners, path traversal, invalid chunks and incomplete uploads', async () => {
    for (const name of ['../Story.m4b', '..\\Story.m4b', 'Story.exe']) {
      await expect(service.create('alice', [{ name, size: 3 }])).rejects.toBeInstanceOf(BadRequestException);
    }
    const { uploadId } = await service.create('alice', [{ name: 'Story.m4b', size: 3 }]);
    await expect(service.putChunk('bob', uploadId, 0, 0, Buffer.from('abc'))).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.cancel('bob', uploadId)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.consume('bob', uploadId, jest.fn())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.putChunk('alice', uploadId, -1, 0, Buffer.from('abc'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.putChunk('alice', uploadId, 0, 1, Buffer.from('abc'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.putChunk('alice', uploadId, 0, 0, Buffer.from('abcd'))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const processFiles = jest.fn();
    await expect(service.consume('alice', uploadId, processFiles)).rejects.toBeInstanceOf(BadRequestException);
    expect(processFiles).not.toHaveBeenCalled();
    await expect(stat(join(directory, '.upload-sessions', uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes finalization and removes temporary files even if metadata processing fails', async () => {
    const { uploadId } = await service.create('alice', [{ name: 'Story.m4b', size: 3 }]);
    await service.putChunk('alice', uploadId, 0, 0, Buffer.from('abc'));
    let finish!: () => void;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const processing = service.consume('alice', uploadId, async () => {
      started();
      await done;
      throw new BadRequestException('Author required');
    });
    await ready;
    await expect(service.consume('alice', uploadId, jest.fn())).rejects.toBeInstanceOf(ConflictException);
    await expect(service.cancel('alice', uploadId)).rejects.toBeInstanceOf(ConflictException);
    const failed = expect(processing).rejects.toThrow('Author required');
    finish();
    await failed;
    await expect(stat(join(directory, '.upload-sessions', uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks the total cloud storage quota before accepting files', async () => {
    process.env.CLOUD_MODE = 'true';
    quota.assertCanStore.mockRejectedValue(new BadRequestException('Quota exceeded'));
    await expect(
      service.create('alice', [
        { name: 'one.mp3', size: 10 },
        { name: 'two.mp3', size: 20 },
      ]),
    ).rejects.toThrow('Quota exceeded');
    expect(quota.assertCanStore).toHaveBeenCalledWith('alice', 30);
  });

  it('cleans expired sessions but retains recent uploads', async () => {
    const expired = await service.create('alice', [{ name: 'old.m4b', size: 1 }]);
    const recent = await service.create('alice', [{ name: 'new.m4b', size: 1 }]);
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(join(directory, '.upload-sessions', expired.uploadId, 'session.json'), old, old);
    await service.cleanExpired();
    await expect(stat(join(directory, '.upload-sessions', expired.uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await stat(join(directory, '.upload-sessions', recent.uploadId))).toBeDefined();
    await service.cancel('alice', recent.uploadId);
    await expect(stat(join(directory, '.upload-sessions', recent.uploadId))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
