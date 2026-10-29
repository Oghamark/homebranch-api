import { EpubArchiveCacheService } from 'src/modules/book/publication/epub-archive-cache.service';

jest.mock('adm-zip', () => {
  return jest.fn().mockImplementation(() => ({ readAsText: jest.fn(), getEntries: () => [] }));
});

describe('EpubArchiveCacheService', () => {
  const storage = {
    getFileStats: jest.fn(),
    getFileBuffer: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reuses a cached archive when size and mtime are unchanged', async () => {
    storage.getFileStats.mockResolvedValue({ size: 4, mtimeMs: 123 });
    storage.getFileBuffer.mockResolvedValue({ key: 'books/book.epub', buffer: Buffer.from('book') });
    const service = new EpubArchiveCacheService(storage as never);

    const first = await service.getArchive('books/book.epub');
    const second = await service.getArchive('books/book.epub');

    expect(second).toBe(first);
    expect(storage.getFileBuffer).toHaveBeenCalledTimes(1);
  });

  it('invalidates an archive when an object-storage ETag changes without changing size/mtime', async () => {
    storage.getFileStats.mockResolvedValue({ size: 4, mtimeMs: 123, etag: 'a' });
    storage.getFileBuffer.mockResolvedValue({ buffer: Buffer.from('book') });
    const service = new EpubArchiveCacheService(storage as never);
    const first = await service.getArchive('books/book.epub');
    storage.getFileStats.mockResolvedValue({ size: 4, mtimeMs: 123, etag: 'b' });
    expect(await service.getArchive('books/book.epub')).not.toBe(first);
    expect(storage.getFileBuffer).toHaveBeenCalledTimes(2);
  });

  it('does not cache a book that changes while being loaded', async () => {
    storage.getFileStats
      .mockResolvedValueOnce({ size: 4, mtimeMs: 123, etag: 'a' })
      .mockResolvedValueOnce({ size: 4, mtimeMs: 123, etag: 'b' });
    storage.getFileBuffer.mockResolvedValue({ buffer: Buffer.from('book') });
    await expect(new EpubArchiveCacheService(storage as never).getArchive('books/book.epub')).rejects.toMatchObject({
      status: 503,
    });
  });
});
