import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { basename, join, extname } from 'path';
import { CreateBookRequest } from 'src/modules/book/dto/create-book-request';
import { CompositeMetadataGateway } from 'src/modules/book/metadata/gateways/composite-metadata.gateway';
import { ContentHashService } from 'src/modules/book/format/content-hash.service';
import { AudioGroupPreview, BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';
import { fillBookMetadataFromFileName } from 'src/modules/book/format/book-file-metadata';
import { buildBookFormatMetadata } from 'src/modules/book/format/book-format-metadata';
import { FileNameGenerator } from 'src/common/utils/filename-generator';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import {
  detectBookFormatFromFileName,
  getBookFormatExtension,
  getPreferredBookFormat,
} from 'src/modules/book/format/book-format';
import { Book, copyBook } from 'src/modules/book/book.model';
import { logicalBookMatches, metadataMatches } from 'src/modules/book/deduplication/book-deduplication.service';
import { BookDuplicateRegistrationService } from 'src/modules/book/deduplication/book-duplicate-registration.service';
import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { randomUUID } from 'crypto';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';
import { stat, unlink } from 'fs-extra';
import { tmpdir } from 'os';
import { StorageQuotaService } from 'src/modules/cloud/storage-quota.service';
import { isCloudMode } from 'src/common/utils/cloud';
import { AudioTrack } from 'src/modules/book/format/audio-track';

export type CreateBookResponse = Book | { skipped: true; existingBook: Book };

@Injectable()
export class BookCreationService {
  private readonly logger = new Logger(BookCreationService.name);

  constructor(
    private readonly duplicateRegistrationService: BookDuplicateRegistrationService,
    private readonly metadataGateway: CompositeMetadataGateway,
    private readonly contentHashService: ContentHashService,
    private readonly bookFormatProcessingService: BookFormatProcessingService,
    private readonly bookPersistenceService: BookPersistenceService,
    private readonly storageQuota: StorageQuotaService,

    @Inject(STORAGE_SERVICE_TOKEN)
    private readonly storage: IStorageService,
  ) {}

  async createBook(dto: CreateBookRequest): Promise<CreateBookResponse> {
    if (!dto.filePath) {
      throw new BadRequestException('A file must be provided');
    }

    const fileSize = (await stat(dto.filePath)).size;
    if (isCloudMode() && dto.uploadedByUserId) {
      await this.storageQuota.assertCanStore(dto.uploadedByUserId, fileSize);
    }

    const originalFileName = basename(dto.filePath);
    const detectedFormat = detectBookFormatFromFileName(originalFileName);
    if (!detectedFormat) {
      this.throwMissingMetadata('format');
    }

    const extension = extname(originalFileName).toLowerCase();
    const tempFileName = `${randomUUID()}${extension}`;
    const incomingPath = join('incoming', tempFileName);

    await this.storage.uploadFileFromPath(dto.filePath, {
      key: incomingPath,
      mimeType: 'application/octet-stream',
    });

    const enrichedDto: Partial<CreateBookRequest> & { originalFileName: string } = { ...dto, originalFileName };

    let parsedSummary: string | undefined;
    let extractedCoverFileName: string | undefined;
    let fileMetadata: BookFileMetadata = {};

    try {
      fileMetadata =
        detectedFormat === BookFormatType.MP3
          ? (await this.bookFormatProcessingService.parseAudioMetadata(dto.filePath)).bookMetadata
          : await this.bookFormatProcessingService.parseMetadata(incomingPath, detectedFormat);

      if (!enrichedDto.title && fileMetadata.title) enrichedDto.title = fileMetadata.title;
      if (!enrichedDto.author && fileMetadata.author) enrichedDto.author = fileMetadata.author;
      if (!enrichedDto.language && fileMetadata.language) enrichedDto.language = fileMetadata.language;
      if (!enrichedDto.publisher && fileMetadata.publisher) enrichedDto.publisher = fileMetadata.publisher;
      if (!enrichedDto.publishedYear && fileMetadata.publishedYear) {
        enrichedDto.publishedYear = String(fileMetadata.publishedYear);
      }
      if (!enrichedDto.isbn && fileMetadata.isbn) enrichedDto.isbn = fileMetadata.isbn;
      if (fileMetadata.summary) parsedSummary = fileMetadata.summary;
      if (!enrichedDto.genres?.length && fileMetadata.genres?.length) enrichedDto.genres = fileMetadata.genres;
      if (!enrichedDto.series && fileMetadata.series) enrichedDto.series = fileMetadata.series;
      if (!enrichedDto.seriesPosition && fileMetadata.seriesPosition) {
        enrichedDto.seriesPosition = fileMetadata.seriesPosition;
      }
      if (!enrichedDto.pageCount && fileMetadata.pageCount) enrichedDto.pageCount = fileMetadata.pageCount;

      if (!enrichedDto.coverImageFileName && fileMetadata.coverImageBuffer) {
        const coverExtension = fileMetadata.coverImageMimeType === 'image/png' ? '.png' : '.jpg';
        const coverFileName = `${randomUUID()}${coverExtension}`;
        await this.storage.uploadFile(fileMetadata.coverImageBuffer, {
          key: `cover-images/${coverFileName}`,
          mimeType: fileMetadata.coverImageMimeType ?? 'image/jpeg',
        });
        enrichedDto.coverImageFileName = coverFileName;
        extractedCoverFileName = coverFileName;
      }
    } catch (error) {
      this.logger.warn(`Could not parse file metadata for "${originalFileName}": ${String(error)}`);
    }

    if (dto.coverImagePath && !enrichedDto.coverImageFileName) {
      const coverFileName = `${randomUUID()}.jpg`;
      await this.storage.uploadFileFromPath(dto.coverImagePath, {
        key: `cover-images/${coverFileName}`,
        mimeType: 'image/jpeg',
      });
      enrichedDto.coverImageFileName = coverFileName;
    }

    fillBookMetadataFromFileName(enrichedDto, originalFileName);

    if (!enrichedDto.title) {
      await this.deleteIncomingFiles(tempFileName, enrichedDto.coverImageFileName, extractedCoverFileName);
      this.throwMissingMetadata('title');
    }
    if (!enrichedDto.author) {
      await this.deleteIncomingFiles(tempFileName, enrichedDto.coverImageFileName, extractedCoverFileName);
      this.throwMissingMetadata('author');
    }

    const ownerScope = isCloudMode() ? enrichedDto.uploadedByUserId : undefined;
    const preferredBook = await this.findMatchingBook(
      enrichedDto.title,
      enrichedDto.author,
      enrichedDto.isbn,
      ownerScope,
    );
    const contentHash = await this.contentHashService.computeHash(incomingPath);
    const existingByHash = await this.bookPersistenceService.findBookByContentHash(contentHash, false, ownerScope);

    if (
      existingByHash &&
      metadataMatches(existingByHash, { title: enrichedDto.title, author: enrichedDto.author, isbn: enrichedDto.isbn })
    ) {
      await this.deleteIncomingFiles(tempFileName, enrichedDto.coverImageFileName, extractedCoverFileName);
      return { skipped: true, existingBook: existingByHash };
    }

    if (preferredBook?.formats?.some((format) => format.format === detectedFormat)) {
      await this.deleteIncomingFiles(tempFileName, enrichedDto.coverImageFileName, extractedCoverFileName);
      return { skipped: true, existingBook: preferredBook };
    }

    const baseFileName = FileNameGenerator.generate(
      enrichedDto.author,
      enrichedDto.title,
      getBookFormatExtension(detectedFormat),
    );
    const desiredFileName = ownerScope ? `${ownerScope}_${baseFileName}` : baseFileName;
    const finalFileName = await this.resolveUniqueFileName(desiredFileName);
    enrichedDto.fileName = finalFileName;
    const newFormat = Object.assign(new BookFormatEntity(), {
      id: randomUUID(),
      format: detectedFormat,
      fileName: finalFileName,
      fileContentHash: contentHash,
      fileSize,
      ...buildBookFormatMetadata(fileMetadata, originalFileName, enrichedDto.coverImageFileName),
    });

    if (preferredBook) {
      const updatedFormats = [...(preferredBook.formats ?? []), newFormat];
      const preferredFormat = getPreferredBookFormat(updatedFormats);
      const updatedBook = copyBook(preferredBook, {
        title: preferredBook.title || enrichedDto.title,
        author: preferredBook.author || enrichedDto.author,
        coverImageFileName: preferredBook.coverImageFileName ?? enrichedDto.coverImageFileName,
        summary: preferredBook.summary ?? parsedSummary,
        genres: preferredBook.genres?.length ? preferredBook.genres : enrichedDto.genres,
        publishedYear: preferredBook.publishedYear ?? this.parseYear(enrichedDto.publishedYear ?? ''),
        uploadedByUserId: preferredBook.uploadedByUserId ?? enrichedDto.uploadedByUserId,
        series: preferredBook.series ?? enrichedDto.series,
        seriesPosition: preferredBook.seriesPosition ?? enrichedDto.seriesPosition,
        isbn: preferredBook.isbn ?? enrichedDto.isbn,
        pageCount: preferredBook.pageCount ?? enrichedDto.pageCount,
        publisher: preferredBook.publisher ?? enrichedDto.publisher,
        language: preferredBook.language ?? enrichedDto.language,
        fileName: preferredFormat?.fileName ?? preferredBook.fileName,
        fileMtime: preferredFormat?.fileMtime ?? preferredBook.fileMtime,
        fileContentHash: preferredFormat?.fileContentHash ?? preferredBook.fileContentHash,
        formats: updatedFormats,
      });

      const persistedBook = await this.bookPersistenceService.updateBookRecord(preferredBook.id, updatedBook);
      await this.storage.moveFile(incomingPath, join('books', finalFileName));
      return persistedBook;
    }

    if (ownerScope) {
      try {
        await this.storageQuota.assertCanAddBook(ownerScope);
      } catch (error) {
        await this.deleteIncomingFiles(tempFileName, enrichedDto.coverImageFileName, extractedCoverFileName);
        throw error;
      }
    }

    const book = new Book(
      randomUUID(),
      enrichedDto.title,
      enrichedDto.author,
      enrichedDto.fileName,
      enrichedDto.isFavorite ?? false,
      enrichedDto.genres,
      enrichedDto.publishedYear ? this.parseYear(enrichedDto.publishedYear) : undefined,
      enrichedDto.coverImageFileName,
      parsedSummary,
      enrichedDto.uploadedByUserId,
      enrichedDto.series,
      enrichedDto.seriesPosition,
      enrichedDto.isbn,
      enrichedDto.pageCount,
      enrichedDto.publisher,
      enrichedDto.language,
      enrichedDto.averageRating,
      enrichedDto.ratingsCount,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      contentHash,
      undefined,
      [newFormat],
    );

    const createdBook = await this.bookPersistenceService.createBookRecord(book);

    await this.storage.moveFile(incomingPath, join('books', finalFileName));

    if (existingByHash) {
      await this.duplicateRegistrationService.flagPotentialDuplicate(createdBook.id, existingByHash.id);
      this.logger.log(`Potential duplicate flagged for new book "${createdBook.title}" (${createdBook.id})`);
    }

    void this.metadataGateway
      .enrichBook(createdBook)
      .then((enriched) => this.bookPersistenceService.updateBookRecord(enriched.id, enriched))
      .catch((error: unknown) => {
        this.logger.warn(`Background metadata fetch failed for book "${book.title}": ${String(error)}`);
      });

    return createdBook;
  }

  async createAudiobook(
    files: Array<{ path: string; originalname: string }>,
    title: string | undefined,
    author: string | undefined,
    uploadedByUserId: string,
  ): Promise<Book> {
    if (files.length < 2 || files.some((file) => extname(file.originalname).toLowerCase() !== '.mp3')) {
      throw new BadRequestException('An audiobook requires at least two MP3 files');
    }
    let firstAudioMetadata: Awaited<ReturnType<BookFormatProcessingService['parseAudioMetadata']>> | undefined;
    const trackTitles: Array<string | undefined> = [];
    for (const [index, file] of files.entries()) {
      try {
        const audioMetadata = await this.bookFormatProcessingService.parseAudioMetadata(file.path, index > 0);
        if (index === 0) {
          firstAudioMetadata = audioMetadata;
        }
        trackTitles.push(audioMetadata.trackTitle);
      } catch (error) {
        this.logger.warn(`Could not parse MP3 metadata for "${file.originalname}": ${String(error)}`);
        trackTitles.push(undefined);
      }
    }
    const firstMetadata = firstAudioMetadata?.bookMetadata;
    const audiobookTitle = title?.trim() || firstAudioMetadata?.albumTitle?.trim();
    if (!audiobookTitle) {
      throw new BadRequestException('Audiobook title is required');
    }
    const firstResult = await this.createBook({
      filePath: files[0].path,
      title: audiobookTitle,
      author: author?.trim() || firstMetadata?.author || 'Unknown Author',
      uploadedByUserId,
    });
    if ('skipped' in firstResult) {
      throw new ConflictException('A book with this audiobook format already exists');
    }

    const mp3Format = firstResult.formats?.find((format) => format.format === BookFormatType.MP3);
    if (!mp3Format) {
      throw new BadRequestException('The first audiobook track could not be registered as MP3');
    }

    const tracks: AudioTrack[] = [
      {
        fileName: mp3Format.fileName,
        title: trackTitles[0] || basename(files[0].originalname, extname(files[0].originalname)),
      },
    ];
    const additionalFileNames: string[] = [];
    try {
      for (const file of files.slice(1)) {
        const fileSize = (await stat(file.path)).size;
        if (isCloudMode() && uploadedByUserId) {
          await this.storageQuota.assertCanStore(uploadedByUserId, fileSize);
        }
        const fileName = `audiobook-tracks/${randomUUID()}.mp3`;
        await this.storage.uploadFileFromPath(file.path, {
          key: `books/${fileName}`,
          mimeType: 'audio/mpeg',
        });
        additionalFileNames.push(fileName);
        tracks.push({
          fileName,
          title: trackTitles[tracks.length] || basename(file.originalname, extname(file.originalname)),
        });
      }

      await this.bookFormatProcessingService.updateAudioTracks(firstResult.id, tracks);
      return this.bookPersistenceService.findBookById(firstResult.id);
    } catch (error) {
      await Promise.all(additionalFileNames.map((fileName) => this.storage.deleteFile(`books/${fileName}`)));
      throw error;
    }
  }

  async previewAudiobook(
    files: Array<{ path: string; originalname: string }>,
    relativePaths: string[],
  ): Promise<AudioGroupPreview[]> {
    if (!files.length || files.some((file) => extname(file.originalname).toLowerCase() !== '.mp3')) {
      throw new BadRequestException('At least one MP3 file is required');
    }
    if (files.length !== relativePaths.length) {
      throw new BadRequestException('Each MP3 file must have a corresponding relative path');
    }
    return this.bookFormatProcessingService.previewAudioGroups(files, relativePaths);
  }

  private async deleteIncomingFiles(
    uploadedFileName: string,
    uploadedCoverFileName?: string,
    extractedCoverFileName?: string,
  ): Promise<void> {
    const filesToDelete = [
      join('incoming', basename(uploadedFileName)),
      uploadedCoverFileName ? join('cover-images', basename(uploadedCoverFileName)) : null,
      extractedCoverFileName ? join('cover-images', basename(extractedCoverFileName)) : null,
    ].filter((filePath): filePath is string => filePath !== null);

    await Promise.all(filesToDelete.map((filePath) => this.storage.deleteFile(filePath)));
    if (uploadedFileName) {
      await unlink(join(tmpdir(), 'uploads', uploadedFileName)).catch(() => {});
    }
    if (uploadedCoverFileName) {
      await unlink(join(tmpdir(), 'uploads', uploadedCoverFileName)).catch(() => {});
    }
  }

  private async resolveUniqueFileName(desiredFileName: string): Promise<string> {
    const exists = await this.storage.exists(join('books', desiredFileName));
    if (!exists) {
      return desiredFileName;
    }

    const extensionIndex = desiredFileName.lastIndexOf('.');
    const ext = extensionIndex >= 0 ? desiredFileName.slice(extensionIndex) : '';
    const nameWithoutExt = extensionIndex >= 0 ? desiredFileName.slice(0, extensionIndex) : desiredFileName;
    let counter = 2;
    let candidate = `${nameWithoutExt} (${counter})${ext}`;
    while (await this.storage.exists(join('books', candidate))) {
      counter++;
      candidate = `${nameWithoutExt} (${counter})${ext}`;
    }
    return candidate;
  }

  private parseYear(year: string): number | undefined {
    const yearNumber = parseInt(year);
    return Number.isNaN(yearNumber) ? undefined : yearNumber;
  }

  private async findMatchingBook(
    title: string,
    author: string,
    isbn?: string,
    ownerScope?: string,
  ): Promise<Book | undefined> {
    if (isbn) {
      const byIsbn = await this.bookPersistenceService.searchBooksWithFilters({ isbn }, 10, 0, ownerScope);
      const match = byIsbn.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
      if (match) {
        try {
          return await this.bookPersistenceService.findBookById(match.id);
        } catch {
          return undefined;
        }
      }
    }

    const byAuthorAndTitle = await this.bookPersistenceService.searchBooksByAuthorAndTitle(
      author,
      title,
      10,
      0,
      ownerScope,
    );
    const byAuthorMatch = byAuthorAndTitle.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
    if (byAuthorMatch) {
      try {
        return await this.bookPersistenceService.findBookById(byAuthorMatch.id);
      } catch {
        return undefined;
      }
    }

    const byTitle = await this.bookPersistenceService.searchBooksWithFilters({ query: title }, 20, 0, ownerScope);
    const byTitleMatch = byTitle.data.find((book) => logicalBookMatches(book, { title, author, isbn }));
    if (byTitleMatch) {
      try {
        return await this.bookPersistenceService.findBookById(byTitleMatch.id);
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private throwMissingMetadata(field: string): never {
    throw new BadRequestException(`Could not determine "${field}" from the uploaded file. Please provide it manually.`);
  }
}
