import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { Repository } from 'typeorm';
import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { EpubParserService } from 'src/modules/book/format/epub-parser.service';
import { PdfParserService } from 'src/modules/book/format/pdf-parser.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { supportsBookFormatMetadataWrite } from 'src/modules/book/format/book-format';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';
import { EpubMetadataWriterService } from 'src/modules/book/format/epub-metadata-writer.service';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { buildBookFormatMetadata, hasStoredFormatMetadata } from 'src/modules/book/format/book-format-metadata';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

type MetadataParser = {
  parse(key: string): Promise<BookFileMetadata>;
};

type MetadataWriter = {
  writeMetadata(key: string, metadata: SyncableMetadata): Promise<void>;
};

@Injectable()
export class BookFormatProcessingService {
  private readonly logger = new Logger(BookFormatProcessingService.name);
  private readonly parsers: Partial<Record<BookFormatType, MetadataParser>>;
  private readonly metadataWriters: Partial<Record<BookFormatType, MetadataWriter>>;

  constructor(
    @InjectRepository(BookEntity) private readonly bookRepository: Repository<BookEntity>,
    @InjectRepository(BookFormatEntity) private readonly formatRepository: Repository<BookFormatEntity>,
    private readonly epubParser: EpubParserService,
    private readonly pdfParser: PdfParserService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
    @Optional() private readonly epubMetadataWriter?: EpubMetadataWriterService,
  ) {
    this.parsers = {
      [BookFormatType.EPUB]: this.epubParser,
      [BookFormatType.PDF]: this.pdfParser,
    };
    this.metadataWriters = {
      [BookFormatType.EPUB]: this.epubMetadataWriter,
    };
  }

  async parseMetadata(key: string, format: BookFormatType): Promise<BookFileMetadata> {
    const parser = this.parsers[format];
    return parser ? parser.parse(key) : {};
  }

  canWriteMetadata(format: BookFormatType): boolean {
    return supportsBookFormatMetadataWrite(format) && Boolean(this.metadataWriters[format]);
  }

  async writeMetadata(key: string, format: BookFormatType, metadata: SyncableMetadata): Promise<boolean> {
    const writer = this.metadataWriters[format];
    if (!writer) {
      return false;
    }
    await writer.writeMetadata(key, metadata);
    return true;
  }

  async hydrateStoredFormatMetadata(bookEntity: BookEntity): Promise<BookEntity> {
    const formats = bookEntity.formats ?? [];
    const missingFormats = formats.filter((format) => !hasStoredFormatMetadata(format));
    if (missingFormats.length === 0) {
      return bookEntity;
    }

    let hasUpdates = false;

    for (const format of missingFormats) {
      const parsedMetadata = await this.parseStoredFormatMetadata(format);
      const coverImageFileName = format.coverImageFileName ?? (await this.extractCoverImage(parsedMetadata));
      const metadata = buildBookFormatMetadata(parsedMetadata, format.fileName, coverImageFileName);

      format.title = metadata.title ?? bookEntity.title;
      format.author = metadata.author ?? bookEntity.author;
      format.genres = metadata.genres;
      format.publishedYear = metadata.publishedYear;
      format.coverImageFileName = metadata.coverImageFileName;
      format.summary = metadata.summary;
      format.series = metadata.series;
      format.seriesPosition = metadata.seriesPosition;
      format.isbn = metadata.isbn;
      format.pageCount = metadata.pageCount;
      format.publisher = metadata.publisher;
      format.language = metadata.language;
      hasUpdates = true;
    }

    if (!hasUpdates) {
      return bookEntity;
    }

    await this.formatRepository.save(missingFormats);
    return (
      (await this.bookRepository.findOne({
        where: { id: bookEntity.id },
        relations: { formats: true },
      })) ?? bookEntity
    );
  }

  private async parseStoredFormatMetadata(format: BookFormatEntity): Promise<BookFileMetadata> {
    const key = join('books', format.fileName);

    try {
      return await this.parseMetadata(key, format.format);
    } catch (error) {
      this.logger.warn(`Could not parse metadata for format "${format.fileName}": ${String(error)}`);
      return {};
    }
  }

  private async extractCoverImage(fileMetadata: BookFileMetadata): Promise<string | undefined> {
    if (!fileMetadata.coverImageBuffer) {
      return undefined;
    }

    const coverImageFileName = `${randomUUID()}.jpg`;
    await this.storage.uploadFile(fileMetadata.coverImageBuffer, {
      key: join('cover-images', coverImageFileName),
      mimeType: 'image/jpeg',
    });
    return coverImageFileName;
  }
}
