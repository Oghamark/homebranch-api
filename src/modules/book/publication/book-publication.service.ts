import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { EpubContentService, PublicationContentEntry } from 'src/modules/book/publication/epub-content.service';
import { EpubManifestService } from 'src/modules/book/publication/epub-manifest.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import {
  getDefaultBookFormatType,
  getRequestedBookFormatFromBook,
  supportsBookFormatContentEntries,
  supportsBookFormatManifest,
} from 'src/modules/book/format/book-format';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';

@Injectable()
export class BookPublicationService {
  private readonly logger = new Logger(BookPublicationService.name);

  constructor(
    private readonly bookPersistenceService: BookPersistenceService,
    private readonly manifestService: EpubManifestService,
    private readonly contentService: EpubContentService,
  ) {}

  async getManifest(id: string, baseUrl: string, format?: BookFormatType): Promise<object> {
    this.logger.log(`Generating publication manifest for book "${id}"`);

    const book = await this.bookPersistenceService.findBookById(id);
    const selectedFormat = getRequestedBookFormatFromBook(book, format);
    if (!selectedFormat) {
      throw new BadRequestException(`Format "${format ?? getDefaultBookFormatType()}" is not available for this book`);
    }
    if (!supportsBookFormatManifest(selectedFormat.format)) {
      throw new BadRequestException(`Format "${selectedFormat.format}" does not support manifest generation`);
    }

    return this.manifestService.generateManifest(
      { ...book, fileName: selectedFormat.fileName },
      baseUrl,
      selectedFormat.id,
    );
  }

  async getContent(id: string, entryPath: string, format?: BookFormatType): Promise<PublicationContentEntry> {
    this.logger.log(`Serving content entry "${entryPath}" for book "${id}"`);

    const book = await this.bookPersistenceService.findBookById(id);
    const selectedFormat = getRequestedBookFormatFromBook(book, format);
    if (!selectedFormat) {
      throw new BadRequestException(`Format "${format ?? getDefaultBookFormatType()}" is not available for this book`);
    }
    if (!supportsBookFormatContentEntries(selectedFormat.format)) {
      throw new BadRequestException(`Format "${selectedFormat.format}" does not support EPUB content access`);
    }

    const entry = await this.contentService.getContent({ ...book, fileName: selectedFormat.fileName }, entryPath);
    if (!entry) {
      throw new NotFoundException(`Content entry "${entryPath}" not found in publication`);
    }
    return entry;
  }
}
