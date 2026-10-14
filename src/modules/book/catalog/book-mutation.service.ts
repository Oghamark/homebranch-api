import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  Inject,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';
import { UpdateBookRequest } from 'src/modules/book/dto/update-book-request';
import { fillBookMetadataFromFileName } from 'src/modules/book/format/book-file-metadata';
import { Book, copyBook } from 'src/modules/book/book.model';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import {
  buildBookFormatMetadata,
  toBookOverridesFromFormat,
  withBookMetadataFallback,
} from 'src/modules/book/format/book-format-metadata';
import { getAvailableBookFormatsFromBook, getPreferredBookFormat } from 'src/modules/book/format/book-format';
import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { FileProcessingQueueService } from 'src/modules/queue/file-processing-queue.service';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

export interface LinkBooksRequest {
  targetBookId: string;
  sourceBookId: string;
  requestingUserId: string;
  requestingUserRole: 'ADMIN' | 'USER';
}

export interface UnlinkBookFormatRequest {
  bookId: string;
  formatId: string;
  requestingUserId: string;
  requestingUserRole: 'ADMIN' | 'USER';
}

@Injectable()
export class BookMutationService {
  private readonly logger = new Logger(BookMutationService.name);

  constructor(
    private readonly bookPersistenceService: BookPersistenceService,
    private readonly fileProcessingQueue: FileProcessingQueueService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,

    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  async updateBook(request: UpdateBookRequest): Promise<Book> {
    const existing = await this.bookPersistenceService.findBookById(request.id);
    const book = copyBook(existing, {
      ...request,
      metadataUpdatedAt: new Date(),
    });

    const updatedBook = await this.bookPersistenceService.updateBookRecord(request.id, book);
    await this.fileProcessingQueue.enqueueMetadataSync(
      request.id,
      updatedBook.fileName,
      `books/${updatedBook.fileName}`,
      { jobId: `sync-${request.id}` },
    );

    return updatedBook;
  }

  async linkBooks(request: LinkBooksRequest): Promise<Book> {
    if (request.targetBookId === request.sourceBookId) {
      throw new BadRequestException('You cannot link a book to itself');
    }

    const [target, source] = await Promise.all([
      this.bookPersistenceService.findBookById(request.targetBookId),
      this.bookPersistenceService.findBookById(request.sourceBookId),
    ]);

    const canLink =
      request.requestingUserRole === 'ADMIN' ||
      (target.uploadedByUserId === request.requestingUserId && source.uploadedByUserId === request.requestingUserId);
    if (!canLink) {
      throw new ForbiddenException('Only an admin or the owner of both books can link them');
    }

    const targetFormats = getAvailableBookFormatsFromBook(target).map((format) =>
      withBookMetadataFallback(format, target),
    );
    const sourceFormats = getAvailableBookFormatsFromBook(source).map((format) =>
      withBookMetadataFallback(format, source),
    );
    const conflictingFormat = sourceFormats.find((sourceFormat) =>
      targetFormats.some((targetFormat) => targetFormat.format === sourceFormat.format),
    );
    if (conflictingFormat) {
      throw new ConflictException(`Both books already contain the "${conflictingFormat.format}" format`);
    }

    const mergedFormats = [...targetFormats, ...sourceFormats];
    const preferredFormat = getPreferredBookFormat(mergedFormats);
    const transferredCoverImage = target.coverImageFileName ?? source.coverImageFileName ?? target.coverImageFileName;

    const mergedBook = copyBook(target, {
      coverImageFileName: transferredCoverImage,
      summary: target.summary ?? source.summary,
      genres: target.genres?.length ? target.genres : source.genres,
      publishedYear: target.publishedYear ?? source.publishedYear,
      uploadedByUserId: target.uploadedByUserId ?? source.uploadedByUserId,
      series: target.series ?? source.series,
      seriesPosition: target.seriesPosition ?? source.seriesPosition,
      isbn: target.isbn ?? source.isbn,
      externalWorkId: target.externalWorkId ?? source.externalWorkId,
      editionId: target.editionId ?? source.editionId,
      pageCount: target.pageCount ?? source.pageCount,
      publisher: target.publisher ?? source.publisher,
      language: target.language ?? source.language,
      averageRating: target.averageRating ?? source.averageRating,
      ratingsCount: target.ratingsCount ?? source.ratingsCount,
      metadataFetchedAt: target.metadataFetchedAt ?? source.metadataFetchedAt,
      lastSyncedAt: target.lastSyncedAt ?? source.lastSyncedAt,
      syncedMetadata: target.syncedMetadata ?? source.syncedMetadata,
      fileName: preferredFormat?.fileName ?? target.fileName,
      fileMtime: preferredFormat?.fileMtime ?? target.fileMtime,
      fileContentHash: preferredFormat?.fileContentHash ?? target.fileContentHash,
      formats: mergedFormats,
      metadataUpdatedAt: new Date(),
    });

    const updatedTarget = await this.bookPersistenceService.updateBookRecord(target.id, mergedBook);

    const preparedSourceBook = copyBook(source, {
      coverImageFileName: transferredCoverImage === source.coverImageFileName ? undefined : source.coverImageFileName,
      formats: [],
    });
    await this.bookPersistenceService.updateBookRecord(source.id, preparedSourceBook);
    await this.bookPersistenceService.permanentDeleteBook(source.id);

    return updatedTarget;
  }

  async unlinkBookFormat(request: UnlinkBookFormatRequest): Promise<Book> {
    const book = await this.bookPersistenceService.findBookById(request.bookId);
    const canUnlink = request.requestingUserRole === 'ADMIN' || book.uploadedByUserId === request.requestingUserId;
    if (!canUnlink) {
      throw new ForbiddenException('Only an admin or the book owner can unlink a format');
    }

    const formats = getAvailableBookFormatsFromBook(book);
    const formatToRemove = formats.find((format) => format.id === request.formatId);
    if (!formatToRemove) {
      throw new NotFoundException('The specified format was not found on this book');
    }
    if (formats.length <= 1) {
      throw new BadRequestException('Cannot unlink the only format of a book');
    }

    const remainingFormats = formats.filter((format) => format.id !== request.formatId);
    const preferredRemaining = getPreferredBookFormat(remainingFormats);
    const updatedBook = copyBook(book, {
      formats: remainingFormats,
      fileName: preferredRemaining?.fileName ?? book.fileName,
      fileMtime: preferredRemaining?.fileMtime ?? book.fileMtime,
      fileContentHash: preferredRemaining?.fileContentHash ?? book.fileContentHash,
      metadataUpdatedAt: new Date(),
    });

    const splitBook = await this.buildSplitBook(book, formatToRemove);
    return this.bookPersistenceService.splitBookFormatRecord(book.id, updatedBook, splitBook);
  }

  private async buildSplitBook(book: Book, format: BookFormatEntity): Promise<Book> {
    const fileMetadata = await this.parseFileMetadata(format);
    const coverImageFileName = await this.extractCoverImage(fileMetadata);
    const splitFormat = Object.assign(new BookFormatEntity(), {
      ...format,
      ...buildBookFormatMetadata(fileMetadata, format.fileName, coverImageFileName),
    });
    const splitBookMetadata = fillBookMetadataFromFileName(
      { ...toBookOverridesFromFormat(splitFormat) },
      format.fileName,
    );

    return new Book(
      randomUUID(),
      splitBookMetadata.title ?? book.title,
      splitBookMetadata.author ?? book.author,
      splitFormat.fileName,
      false,
      splitBookMetadata.genres ?? [],
      splitBookMetadata.publishedYear,
      splitBookMetadata.coverImageFileName,
      splitBookMetadata.summary,
      book.uploadedByUserId,
      splitBookMetadata.series,
      splitBookMetadata.seriesPosition,
      splitBookMetadata.isbn,
      splitBookMetadata.pageCount,
      splitBookMetadata.publisher,
      splitBookMetadata.language,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      splitFormat.fileMtime,
      splitFormat.fileContentHash,
      undefined,
      [splitFormat],
      splitBookMetadata.externalWorkId,
      splitBookMetadata.editionId,
    );
  }

  private async parseFileMetadata(format: BookFormatEntity): Promise<BookFileMetadata> {
    const filePath = join('books', format.fileName).replace(/\\/g, '/');

    try {
      return await this.bookFormatProcessingService.parseMetadata(filePath, format.format);
    } catch (error) {
      this.logger.warn(`Could not parse metadata for unlinked format "${format.fileName}": ${String(error)}`);
      return {};
    }
  }

  private async extractCoverImage(fileMetadata: BookFileMetadata): Promise<string | undefined> {
    if (!fileMetadata.coverImageBuffer) {
      return undefined;
    }

    const coverFileName = `${randomUUID()}.jpg`;
    const coverPath = join('cover-images', coverFileName);
    await this.storage.uploadFile(fileMetadata.coverImageBuffer, { key: coverPath, mimeType: 'image/jpeg' });
    return coverFileName;
  }
}
