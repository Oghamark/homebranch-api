import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { join, basename, extname } from 'path';
import { randomUUID } from 'crypto';
import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { Book, copyBook } from 'src/modules/book/book.model';
import { ContentHashService } from 'src/modules/book/format/content-hash.service';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { AudioChapter } from 'src/modules/book/format/audio-chapter';
import {
  detectBookFormatFromFileName,
  getAvailableBookFormatsFromBook,
  getBookFormatByFileName,
  getPreferredBookFormat,
} from 'src/modules/book/format/book-format';
import {
  buildBookFormatMetadata,
  cloneBookFormat,
  withBookMetadataFallback,
} from 'src/modules/book/format/book-format-metadata';
import { fillBookMetadataFromFileName } from 'src/modules/book/format/book-file-metadata';
import { SyncableMetadata, SyncableMetadataHelper } from 'src/common/value-objects/syncable-metadata';
import { logicalBookMatches } from 'src/modules/book/deduplication/book-deduplication.service';
import { MetadataMerger } from 'src/modules/library-sync/metadata-merger';
import { LibraryEventsService } from 'src/modules/library-sync/library-events.service';
import { BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';
import { CompositeMetadataGateway } from 'src/modules/book/metadata/gateways/composite-metadata.gateway';
import { SettingsService } from 'src/modules/settings/settings.service';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../storage/storage.interface';

@Processor('file-processing')
export class FileProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(FileProcessingProcessor.name);

  constructor(
    private readonly bookPersistenceService: BookPersistenceService,
    private readonly contentHashService: ContentHashService,
    private readonly metadataGateway: CompositeMetadataGateway,
    private readonly settingsService: SettingsService,
    private readonly libraryEventsService: LibraryEventsService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'process-new-file':
        await this.processNewFile(job as Job<{ fileName: string; filePath: string }>);
        break;
      case 'sync-metadata':
        await this.syncMetadata(
          job as Job<{
            bookId: string;
            fileName: string;
            filePath: string;
            preferredDbFields?: (keyof SyncableMetadata)[];
          }>,
        );
        break;
      case 'soft-delete-book':
        await this.softDeleteBook(job as Job<{ bookId: string; fileName: string }>);
        break;
      case 'rename-legacy-file':
        await this.renameLegacyFile(job as Job<{ bookId: string; currentFileName: string; newFileName: string }>);
        break;
      default:
        this.logger.warn(`Unknown job name: ${job.name}`);
    }
  }

  private async processNewFile(job: Job<{ fileName: string; filePath: string }>) {
    const { fileName, filePath } = job.data;
    this.logger.log(`Processing new file: ${fileName}`);
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) {
      this.logger.warn(`Unsupported file format for "${fileName}"`);
      await job.updateProgress(100);
      return;
    }
    await job.updateProgress(10);

    const contentHash = await this.contentHashService.computeHash(filePath);
    await job.updateProgress(30);

    // Check for soft-deleted book with same filename
    const byName = await this.bookPersistenceService.findBookByFileName(fileName, true);
    if (byName?.deletedAt) {
      this.logger.log(`Restoring soft-deleted book by filename: "${byName.title}"`);
      await this.bookPersistenceService.restoreBookRecord(byName.id);
      await this.updateBookFileMetadata(byName.id, fileName, filePath, contentHash);
      await this.performMetadataSync(byName.id, filePath, fileName);
      this.libraryEventsService.emit({ type: 'book-added', bookId: byName.id });
      await job.updateProgress(100);
      return;
    }

    // Check for soft-deleted book with same content hash
    const byHash = await this.bookPersistenceService.findBookByContentHash(contentHash, true);
    if (byHash?.deletedAt) {
      this.logger.log(`Restoring soft-deleted book by content hash: "${byHash.title}" (was "${byHash.fileName}")`);
      const stat = await this.storage.getFileStats(filePath);
      const restoredFormat = withBookMetadataFallback(
        Object.assign(new BookFormatEntity(), {
          id: randomUUID(),
          format: detectedFormat,
          fileName,
          fileMtime: stat.mtimeMs,
          fileContentHash: contentHash,
        }),
        byHash,
      );
      const book = this.withUpsertedFormat(byHash, restoredFormat, { deletedAt: undefined });
      await this.bookPersistenceService.updateBookRecord(byHash.id, book);
      await this.bookPersistenceService.restoreBookRecord(byHash.id);
      await this.updateBookFileMetadata(byHash.id, fileName, filePath, contentHash);
      this.libraryEventsService.emit({ type: 'book-added', bookId: byHash.id });
      await job.updateProgress(100);
      return;
    }

    // Already exists and active — check if file content changed
    if (byName && !byName.deletedAt) {
      const existingBook = byName;
      const existingFormat = getBookFormatByFileName(existingBook, fileName);
      if (existingFormat?.fileContentHash !== contentHash) {
        this.logger.log(`File content changed for existing book "${existingBook.title}", syncing metadata`);
        await this.performMetadataSync(existingBook.id, filePath, fileName);
      } else {
        this.logger.debug(`Book already exists and unchanged: ${fileName}`);
      }
      await job.updateProgress(100);
      return;
    }

    // New book or new format — parse file metadata
    await job.updateProgress(40);

    const parsedFile = await this.parseBookFileMetadata(filePath, fileName);
    const fileMetadata = parsedFile.bookMetadata;
    const seededFileMetadata = fillBookMetadataFromFileName({ ...fileMetadata }, fileName);
    const title = seededFileMetadata.title ?? basename(fileName, extname(fileName));
    const author = seededFileMetadata.author ?? 'Unknown Author';

    await job.updateProgress(60);

    // Extract and save cover image
    let coverImageFileName: string | undefined;
    if (fileMetadata.coverImageBuffer) {
      coverImageFileName = `${randomUUID()}.jpg`;
      await this.storage.uploadFile(fileMetadata.coverImageBuffer, {
        key: `cover-images/${coverImageFileName}`,
        mimeType: 'image/jpeg',
      });
    }

    const stat = await this.storage.getFileStats(filePath);
    const formatMetadata = {
      ...buildBookFormatMetadata(fileMetadata, fileName, coverImageFileName),
      title,
      author,
    };
    const newFormat = Object.assign(new BookFormatEntity(), {
      id: randomUUID(),
      format: detectedFormat,
      fileName,
      fileMtime: stat.mtimeMs,
      fileContentHash: contentHash,
      audioChapters: parsedFile.audioChapters,
      ...formatMetadata,
    });
    const id = randomUUID();
    const syncSnapshot = SyncableMetadataHelper.fromBook({
      title,
      author,
      language: formatMetadata.language,
      publisher: formatMetadata.publisher,
      publishedYear: formatMetadata.publishedYear,
      isbn: formatMetadata.isbn,
      summary: formatMetadata.summary,
      genres: formatMetadata.genres,
      series: formatMetadata.series,
      seriesPosition: formatMetadata.seriesPosition,
    }) as unknown as Record<string, unknown>;

    const defaultOwnerId = await this.getDefaultScanUserId();

    const matchingBook = await this.findMatchingBook(title, author, fileMetadata.isbn);
    if (matchingBook) {
      const existingBook = matchingBook;
      const formatExists = getAvailableBookFormatsFromBook(existingBook).some(
        (format) => format.format === detectedFormat,
      );
      if (!formatExists) {
        const updatedBook = this.withUpsertedFormat(existingBook, newFormat, {
          coverImageFileName: existingBook.coverImageFileName ?? coverImageFileName,
          summary: existingBook.summary ?? formatMetadata.summary,
          genres: existingBook.genres?.length ? existingBook.genres : formatMetadata.genres,
          publishedYear: existingBook.publishedYear ?? formatMetadata.publishedYear,
          uploadedByUserId: existingBook.uploadedByUserId ?? defaultOwnerId,
          series: existingBook.series ?? formatMetadata.series,
          seriesPosition: existingBook.seriesPosition ?? formatMetadata.seriesPosition,
          isbn: existingBook.isbn ?? formatMetadata.isbn,
          pageCount: existingBook.pageCount ?? formatMetadata.pageCount,
          publisher: existingBook.publisher ?? formatMetadata.publisher,
          language: existingBook.language ?? formatMetadata.language,
          syncedMetadata: syncSnapshot,
          lastSyncedAt: new Date(),
        });
        await this.bookPersistenceService.updateBookRecord(existingBook.id, updatedBook);
        this.logger.log(`Attached ${detectedFormat} format to existing book "${existingBook.title}"`);
        this.libraryEventsService.emit({ type: 'book-updated', bookId: existingBook.id });
      }
      await job.updateProgress(100);
      return;
    }

    const book = new Book(
      id,
      title,
      author,
      fileName,
      false, // isFavorite
      formatMetadata.genres || [],
      formatMetadata.publishedYear,
      coverImageFileName,
      formatMetadata.summary,
      defaultOwnerId, // uploadedByUserId — use default scan user if configured
      formatMetadata.series,
      formatMetadata.seriesPosition,
      formatMetadata.isbn,
      formatMetadata.pageCount,
      formatMetadata.publisher,
      formatMetadata.language,
      undefined, // averageRating
      undefined, // ratingsCount
      undefined, // metadataFetchedAt
      undefined, // createdAt
      undefined, // deletedAt
      new Date(), // lastSyncedAt
      syncSnapshot,
      stat.mtimeMs,
      contentHash,
      undefined, // metadataUpdatedAt
      [newFormat],
    );

    await job.updateProgress(80);

    const createdBook = await this.bookPersistenceService.createBookRecord(book);
    this.logger.log(`Created book from scan: "${title}" by ${author}`);
    this.libraryEventsService.emit({ type: 'book-added', bookId: createdBook.id });

    void this.metadataGateway
      .enrichBook(createdBook)
      .then((enriched) => this.bookPersistenceService.updateBookRecord(enriched.id, enriched))
      .then(() => {
        this.libraryEventsService.emit({ type: 'book-updated', bookId: createdBook.id });
      })
      .catch((err: unknown) => {
        this.logger.warn(`Background metadata fetch failed for "${title}": ${String(err)}`);
      });

    await job.updateProgress(100);
  }

  private async updateBookFileMetadata(bookId: string, fileName: string, filePath: string, contentHash: string) {
    const stat = await this.storage.getFileStats(filePath);
    try {
      const book = await this.bookPersistenceService.findBookById(bookId);
      const updatedBook = this.withUpdatedFormatState(book, fileName, {
        fileMtime: stat.mtimeMs,
        fileContentHash: contentHash,
        lastSyncedAt: new Date(),
      });
      await this.bookPersistenceService.updateBookRecord(bookId, updatedBook);
    } catch {
      this.logger.debug(`Skipping file metadata update because book ${bookId} no longer exists`);
    }
  }

  private async syncMetadata(
    job: Job<{ bookId: string; fileName: string; filePath: string; preferredDbFields?: (keyof SyncableMetadata)[] }>,
  ) {
    const { bookId, filePath } = job.data;
    this.logger.log(`Syncing metadata for book ${bookId}`);
    await job.updateProgress(10);
    await this.performMetadataSync(bookId, filePath, job.data.fileName, job.data.preferredDbFields);
    await job.updateProgress(100);
  }

  private async performMetadataSync(
    bookId: string,
    filePath: string,
    fileName: string,
    preferredDbFields?: (keyof SyncableMetadata)[],
  ): Promise<void> {
    let book: Book;
    try {
      book = await this.bookPersistenceService.findBookById(bookId);
    } catch {
      this.logger.warn(`Book ${bookId} not found for sync`);
      return;
    }
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) {
      this.logger.warn(`Unsupported format for sync: ${fileName}`);
      return;
    }

    let fileMetadata: SyncableMetadata;
    let audioChapters: AudioChapter[] | undefined;
    try {
      const parsedFile = await this.parseBookFileMetadata(filePath, fileName);
      const parsedMetadata = parsedFile.bookMetadata;
      audioChapters = parsedFile.audioChapters;
      fileMetadata = SyncableMetadataHelper.fromBook({
        title: parsedMetadata.title || book.title,
        author: parsedMetadata.author || book.author,
        language: parsedMetadata.language,
        publisher: parsedMetadata.publisher,
        publishedYear: parsedMetadata.publishedYear,
        isbn: parsedMetadata.isbn,
        summary: parsedMetadata.summary,
        genres: parsedMetadata.genres,
        series: parsedMetadata.series,
        seriesPosition: parsedMetadata.seriesPosition,
      });
    } catch (err) {
      this.logger.warn(`Cannot parse file for sync: ${String(err)}`);
      return;
    }

    const dbMetadata = SyncableMetadataHelper.fromBook(book);
    const lastSynced = (book.syncedMetadata as unknown as SyncableMetadata) || null;
    const mergeResult = MetadataMerger.merge(fileMetadata, dbMetadata, lastSynced, this.logger, preferredDbFields);

    const stat = await this.storage.getFileStats(filePath);
    let finalMtime = stat.mtimeMs;
    let finalHash = await this.contentHashService.computeHash(filePath);

    if (mergeResult.fileUpdated && this.bookFormatProcessingService.canWriteMetadata(detectedFormat)) {
      try {
        await this.bookFormatProcessingService.writeMetadata(filePath, detectedFormat, mergeResult.merged);

        // Recompute hash and stat after writing since the file changed
        const postWriteStat = await this.storage.getFileStats(filePath);
        finalMtime = postWriteStat.mtimeMs;
        finalHash = await this.contentHashService.computeHash(filePath);
        this.logger.log(`Updated file metadata for "${book.title}"`);
      } catch (err) {
        this.logger.error(`Failed to write metadata to file: ${String(err)}`);
        throw err;
      }
    }

    if (mergeResult.dbUpdated || mergeResult.fileUpdated) {
      // Always spread mergeResult.merged so that dbUpdated field changes are not
      // overwritten when fileUpdated also triggers a DB save.
      const updatedBook = copyBook(book, {
        ...mergeResult.merged,
        lastSyncedAt: new Date(),
        syncedMetadata: mergeResult.merged as unknown as Record<string, unknown>,
      });
      await this.bookPersistenceService.updateBookRecord(
        bookId,
        this.withUpdatedFormatState(this.withAudioChapters(updatedBook, fileName, audioChapters), fileName, {
          fileMtime: finalMtime,
          fileContentHash: finalHash,
        }),
      );
      if (mergeResult.dbUpdated) this.logger.log(`Updated DB metadata for "${book.title}"`);
      this.libraryEventsService.emit({ type: 'book-updated', bookId });
    } else {
      // No metadata changes — still update file-tracking fields so the periodic
      // scan does not re-trigger sync indefinitely.
      const updatedBook = this.withUpdatedFormatState(book, fileName, {
        lastSyncedAt: new Date(),
        fileMtime: finalMtime,
        fileContentHash: finalHash,
      });
      await this.bookPersistenceService.updateBookRecord(
        bookId,
        this.withAudioChapters(updatedBook, fileName, audioChapters),
      );
    }
  }

  private async softDeleteBook(job: Job<{ bookId: string; fileName: string }>) {
    const { bookId, fileName } = job.data;
    this.logger.log(`Soft-deleting book ${bookId} (file "${fileName}" removed)`);

    let book: Book;
    try {
      book = await this.bookPersistenceService.findBookById(bookId);
    } catch {
      return;
    }

    const remainingFormats = getAvailableBookFormatsFromBook(book).filter((format) => format.fileName !== fileName);
    if (remainingFormats.length === 0) {
      const deletedBook = await this.bookPersistenceService.softDeleteBookRecord(bookId);
      this.logger.log(`Soft-deleted book "${deletedBook.title}"`);
      this.libraryEventsService.emit({ type: 'book-removed', bookId });
      await job.updateProgress(100);
      return;
    }

    const preferredFormat = getPreferredBookFormat(remainingFormats);
    const updatedBook = copyBook(book, {
      fileName: preferredFormat?.fileName ?? book.fileName,
      fileMtime: preferredFormat?.fileMtime ?? book.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? book.fileContentHash,
      formats: remainingFormats,
    });
    await this.bookPersistenceService.updateBookRecord(bookId, updatedBook);
    this.libraryEventsService.emit({ type: 'book-updated', bookId });
    await job.updateProgress(100);
  }

  private async renameLegacyFile(job: Job<{ bookId: string; currentFileName: string; newFileName: string }>) {
    const { bookId, currentFileName, newFileName } = job.data;
    this.logger.log(`Renaming legacy file: ${currentFileName} → ${newFileName}`);

    const currentPath = join('books', basename(currentFileName));
    const newPath = join('books', basename(newFileName));

    const currentExists = await this.storage.exists(currentPath);
    if (!currentExists) {
      this.logger.warn(`Source file not found: ${currentPath}`);
      return;
    }

    const newExists = await this.storage.exists(newPath);
    if (newExists) {
      this.logger.warn(`Target file already exists: ${newPath}`);
      return;
    }

    try {
      await this.storage.moveFile(currentPath, newPath);

      try {
        const book = await this.bookPersistenceService.findBookById(bookId);
        const matchingFormat = getBookFormatByFileName(book, currentFileName);
        const updatedFormats = getAvailableBookFormatsFromBook(book).map((format) =>
          format.fileName === currentFileName ? cloneBookFormat(format, { fileName: newFileName }) : format,
        );
        const preferredFormat = getPreferredBookFormat(updatedFormats);
        const updatedBook = copyBook(book, {
          fileName: book.fileName === currentFileName ? newFileName : (preferredFormat?.fileName ?? book.fileName),
          formats: matchingFormat ? updatedFormats : book.formats,
        });
        await this.bookPersistenceService.updateBookRecord(bookId, updatedBook);
        this.logger.log(`Renamed: ${currentFileName} → ${newFileName}`);
      } catch {
        await this.storage.moveFile(newPath, currentPath);
        this.logger.error(`DB update failed, rolled back rename for ${currentFileName}`);
      }
    } catch (error) {
      this.logger.error(`Failed to rename ${currentFileName}: ${String(error)}`);
    }

    await job.updateProgress(100);
  }

  private async getDefaultScanUserId(): Promise<string | undefined> {
    const settingValue = await this.settingsService.getOptionalValue('default_scan_user_id');
    return settingValue?.trim() || undefined;
  }

  private async parseBookFileMetadata(
    filePath: string,
    fileName: string,
  ): Promise<{ bookMetadata: BookFileMetadata; audioChapters?: AudioChapter[] }> {
    const detectedFormat = detectBookFormatFromFileName(fileName);
    if (!detectedFormat) return { bookMetadata: {} };
    if (detectedFormat === BookFormatType.MP3 || detectedFormat === BookFormatType.M4B) {
      const parsedAudio = await this.bookFormatProcessingService.parseAudioMetadata(filePath);
      return { bookMetadata: parsedAudio.bookMetadata, audioChapters: parsedAudio.chapters };
    }
    return { bookMetadata: await this.bookFormatProcessingService.parseMetadata(filePath, detectedFormat) };
  }

  private withAudioChapters(book: Book, fileName: string, chapters?: AudioChapter[]): Book {
    if (!chapters) return book;
    const formats = getAvailableBookFormatsFromBook(book).map((format) => {
      if (format.fileName !== fileName) return format;
      return cloneBookFormat(format, {
        audioChapters: format.audioTracks && format.audioTracks.length > 1 ? [] : chapters,
      });
    });
    return copyBook(book, { formats });
  }

  private async findMatchingBook(title: string, author: string, isbn?: string): Promise<Book | null> {
    if (isbn) {
      const byIsbn = await this.bookPersistenceService.searchBooksWithFilters({ isbn }, 10, 0);
      const match = byIsbn.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
      if (match) {
        try {
          return await this.bookPersistenceService.findBookById(match.id);
        } catch {
          return null;
        }
      }
    }

    const byAuthorAndTitle = await this.bookPersistenceService.searchBooksByAuthorAndTitle(author, title, 10, 0);
    const byAuthorMatch = byAuthorAndTitle.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
    if (byAuthorMatch) {
      try {
        return await this.bookPersistenceService.findBookById(byAuthorMatch.id);
      } catch {
        return null;
      }
    }

    const byTitle = await this.bookPersistenceService.searchBooksWithFilters({ query: title }, 20, 0);
    const byTitleMatch = byTitle.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
    if (byTitleMatch) {
      try {
        return await this.bookPersistenceService.findBookById(byTitleMatch.id);
      } catch {
        return null;
      }
    }

    return null;
  }

  private withUpsertedFormat(book: Book, nextFormat: BookFormatEntity, overrides: Partial<Book> = {}): Book {
    const existingFormats = getAvailableBookFormatsFromBook(book)
      .filter((format) => format.fileName !== nextFormat.fileName)
      .map((format) => withBookMetadataFallback(format, book));
    const formats = [...existingFormats, nextFormat];
    const preferredFormat = getPreferredBookFormat(formats);
    return copyBook(book, {
      ...overrides,
      fileName: preferredFormat?.fileName ?? overrides.fileName ?? book.fileName,
      fileMtime: preferredFormat?.fileMtime ?? overrides.fileMtime ?? book.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? overrides.fileContentHash ?? book.fileContentHash,
      formats,
    });
  }

  private withUpdatedFormatState(book: Book, fileName: string, overrides: Partial<Book>): Book {
    const formats = getAvailableBookFormatsFromBook(book).map((format) =>
      format.fileName === fileName ? cloneBookFormat(format, this.toFormatOverrides(overrides)) : format,
    );
    const { fileMtime, fileContentHash, ...restOverrides } = overrides;
    const baseBook = copyBook(book, { ...restOverrides, formats });
    if (book.fileName === fileName) {
      return copyBook(baseBook, {
        fileMtime: fileMtime ?? book.fileMtime,
        fileContentHash: fileContentHash ?? book.fileContentHash,
      });
    }
    return baseBook;
  }

  private toFormatOverrides(overrides: Partial<Book>): Partial<BookFormatEntity> {
    return {
      fileMtime: overrides.fileMtime,
      fileContentHash: overrides.fileContentHash,
      title: overrides.title,
      author: overrides.author,
      genres: overrides.genres,
      publishedYear: overrides.publishedYear,
      coverImageFileName: overrides.coverImageFileName,
      summary: overrides.summary,
      series: overrides.series,
      seriesPosition: overrides.seriesPosition,
      isbn: overrides.isbn,
      pageCount: overrides.pageCount,
      publisher: overrides.publisher,
      language: overrides.language,
    };
  }
}
