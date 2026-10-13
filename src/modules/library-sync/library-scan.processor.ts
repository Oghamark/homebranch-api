import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LibraryEventsService } from 'src/modules/library-sync/library-events.service';
import { Book } from 'src/modules/book/book.model';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import {
  getAvailableBookFormatsFromBook,
  getBookFormatByFileName,
  isSupportedBookFile,
} from 'src/modules/book/format/book-format';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../storage/storage.interface';
import { StorageFileItem } from '../storage/storage.types';

@Processor('library-scan')
export class LibraryScanProcessor extends WorkerHost {
  private readonly logger = new Logger(LibraryScanProcessor.name);

  constructor(
    private readonly bookPersistenceService: BookPersistenceService,
    @InjectQueue('file-processing') private readonly fileProcessingQueue: Queue,
    private readonly libraryEventsService: LibraryEventsService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'scan-directory':
        await this.scanDirectory(job as Job<{ trigger: string; booksDirectory: string }>);
        break;
      case 'file-removed':
        await this.handleFileRemoved(job as Job<{ fileName: string }>);
        break;
      case 'process-file':
        await this.handleProcessFile(job as Job<{ fileName: string; filePath: string; event: string }>);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async scanDirectory(job: Job<{ trigger: string; booksDirectory: string }>) {
    const { booksDirectory, trigger } = job.data;
    this.logger.log(`Scanning library (trigger: ${trigger}): ${booksDirectory}`);

    let files: StorageFileItem[];
    try {
      files = await this.storage
        .listFiles('books', true)
        .then((storageFileItems) =>
          storageFileItems.filter(
            (f) =>
              isSupportedBookFile(f.fileName) &&
              !f.fileName.startsWith('.') &&
              !f.key.startsWith('books/audiobook-tracks/'),
          ),
        );
    } catch (error) {
      this.logger.error(`Cannot read books directory: ${String(error)}`);
      return;
    }

    let dbBooks: Book[];
    try {
      dbBooks = await this.bookPersistenceService.findAllActiveBooks();
    } catch {
      this.logger.error('Failed to load active books from database');
      return;
    }
    const trackedFiles = dbBooks.flatMap((book) =>
      getAvailableBookFormatsFromBook(book).map((format) => ({ book, format })),
    );
    const dbFileNames = new Set(trackedFiles.map(({ format }) => format.fileName));
    const diskFileNames = new Set(files.map((file) => file.fileName));

    let processed = 0;
    const total = files.length + trackedFiles.length;

    // Detect new or changed files
    for (const file of files) {
      if (!dbFileNames.has(file.fileName)) {
        const filePath = file.key;
        await this.fileProcessingQueue.add(
          'process-new-file',
          { fileName: file.fileName, filePath },
          { jobId: `new-${file.fileName}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
        );
      } else {
        // Check for metadata changes via mtime
        const filePath = file.key;
        try {
          const mtime: number = file.updatedAt.getTime();
          const trackedFile = trackedFiles.find(({ format }) => format.fileName === file.fileName);
          if (trackedFile?.format.fileMtime && Math.abs(mtime - trackedFile.format.fileMtime) > 1000) {
            await this.fileProcessingQueue.add(
              'sync-metadata',
              { bookId: trackedFile.book.id, fileName: file.fileName, filePath },
              { jobId: `sync-${trackedFile.book.id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
            );
          }
        } catch {
          this.logger.warn(`Cannot stat file: ${filePath}`);
        }
      }
      processed++;
      await job.updateProgress(Math.round((processed / total) * 100));
    }

    // Detect removed files
    for (const { book, format } of trackedFiles) {
      if (!diskFileNames.has(format.fileName)) {
        await this.fileProcessingQueue.add(
          'soft-delete-book',
          { bookId: book.id, fileName: format.fileName },
          { removeOnComplete: 100, removeOnFail: 50 },
        );
      }
      processed++;
      await job.updateProgress(Math.round((processed / total) * 100));
    }

    this.logger.log(`Scan complete: ${files.length} files on disk, ${dbBooks.length} books in DB`);
  }

  private async handleFileRemoved(job: Job<{ fileName: string }>) {
    const { fileName } = job.data;
    this.logger.log(`Handling file removal: ${fileName}`);

    const book = await this.bookPersistenceService.findBookByFileName(fileName);
    if (book) {
      await this.bookPersistenceService.softDeleteBookRecord(book.id);
      this.logger.log(`Soft-deleted book "${book.title}" (file removed)`);
      this.libraryEventsService.emit({ type: 'book-removed', bookId: book.id });
    }
  }

  private async handleProcessFile(job: Job<{ fileName: string; filePath: string; event: string }>) {
    const { fileName, filePath, event } = job.data;

    if (event === 'add') {
      await this.fileProcessingQueue.add(
        'process-new-file',
        { fileName, filePath },
        { jobId: `new-${fileName}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
      );
    } else if (event === 'change') {
      const book = await this.bookPersistenceService.findBookByFileName(fileName);
      if (book) {
        const trackedFormat = getBookFormatByFileName(book, fileName);
        if (!trackedFormat) return;
        // Use a timestamp suffix to avoid BullMQ's jobId deduplication: the Lua
        // addStandardJob script blocks re-adding any job whose key still exists in
        // Redis, including completed jobs kept by removeOnComplete. A unique ID
        // ensures every file-change event triggers a real sync.
        await this.fileProcessingQueue.add(
          'sync-metadata',
          { bookId: book.id, fileName, filePath },
          { jobId: `sync-${book.id}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
        );
        this.logger.log(`Enqueued metadata sync for "${fileName}" (book ${book.id})`);
      } else {
        this.logger.warn(`File change detected for "${fileName}" but no matching book found in database`);
      }
    }
  }
}
