import { LibraryScanProcessor } from 'src/modules/library-sync/library-scan.processor';

describe('LibraryScanProcessor', () => {
  const bookPersistenceService = {
    findAllActiveBooks: jest.fn(),
  };
  const fileProcessingQueue = {
    add: jest.fn(),
  };
  const libraryEventsService = {
    emit: jest.fn(),
  };
  const storage = {
    listFiles: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('queues scan-discovered new files with storage keys, not physical paths', async () => {
    storage.listFiles.mockResolvedValue([
      {
        key: 'books/New Book.epub',
        fileName: 'New Book.epub',
        size: 123,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      },
      {
        key: 'books/audiobook-tracks/track-2.mp3',
        fileName: 'track-2.mp3',
        size: 456,
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      },
    ]);
    bookPersistenceService.findAllActiveBooks.mockResolvedValue([]);
    const processor = new LibraryScanProcessor(
      bookPersistenceService as never,
      fileProcessingQueue as never,
      libraryEventsService as never,
      storage as never,
    );

    await processor.process({
      name: 'scan-directory',
      data: { trigger: 'manual', booksDirectory: '/uploads/books' },
      updateProgress: jest.fn(),
    } as never);

    expect(fileProcessingQueue.add).toHaveBeenCalledWith(
      'process-new-file',
      { fileName: 'New Book.epub', filePath: 'books/New Book.epub' },
      expect.objectContaining({ removeOnComplete: 100, removeOnFail: 50 }),
    );
    expect(fileProcessingQueue.add).toHaveBeenCalledTimes(1);
  });
});
