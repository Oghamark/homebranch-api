import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { open } from 'fs/promises';
import { extname, join } from 'path';
import { Readable } from 'stream';
import { Repository } from 'typeorm';
import { BookFileMetadata } from 'src/modules/book/format/book-file-metadata.interface';
import { EpubParserService } from 'src/modules/book/format/epub-parser.service';
import { PdfParserService } from 'src/modules/book/format/pdf-parser.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { supportsBookFormatMetadataWrite } from 'src/modules/book/format/book-format';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';
import { EpubMetadataWriterService } from 'src/modules/book/format/epub-metadata-writer.service';
import { PdfMetadataWriterService } from 'src/modules/book/format/pdf-metadata-writer.service';
import { Mp3MetadataWriterService } from 'src/modules/book/format/mp3-metadata-writer.service';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { AudioTrack } from 'src/modules/book/format/audio-track';
import { AudioChapter } from 'src/modules/book/format/audio-chapter';
import { buildBookFormatMetadata, hasStoredFormatMetadata } from 'src/modules/book/format/book-format-metadata';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';
import { parseFile, parseStream } from 'music-metadata';
import { parseMp4Chapters } from './mp4-chapters';

export interface ParsedAudioMetadata {
  bookMetadata: BookFileMetadata;
  chapters: AudioChapter[];
  albumTitle?: string;
  albumArtist?: string;
  trackTitle?: string;
  discNumber?: number | null;
  trackNumber?: number | null;
}

export interface AudioTrackPreview {
  index: number;
  path: string;
  title: string;
}

export interface AudioGroupPreview {
  title: string;
  author: string;
  source: 'tags' | 'folder';
  tracks: AudioTrackPreview[];
}

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
    @Optional() private readonly pdfMetadataWriter?: PdfMetadataWriterService,
    @Optional() private readonly mp3MetadataWriter?: Mp3MetadataWriterService,
  ) {
    this.parsers = {
      [BookFormatType.EPUB]: this.epubParser,
      [BookFormatType.PDF]: this.pdfParser,
    };
    this.metadataWriters = {
      [BookFormatType.EPUB]: this.epubMetadataWriter,
      [BookFormatType.PDF]: this.pdfMetadataWriter,
      [BookFormatType.MP3]: this.mp3MetadataWriter,
    };
  }

  async parseMetadata(key: string, format: BookFormatType): Promise<BookFileMetadata> {
    if (format === BookFormatType.MP3 || format === BookFormatType.M4B) {
      return (await this.parseStoredAudioMetadata(key, false)).bookMetadata;
    }
    const parser = this.parsers[format];
    return parser ? parser.parse(key) : {};
  }

  async parseAudioMetadata(filePath: string, skipCovers = false): Promise<ParsedAudioMetadata> {
    const metadata = await parseFile(filePath, { skipCovers, includeChapters: true });
    const parsed = this.toParsedAudioMetadata(metadata);
    if (!parsed.chapters.length && extname(filePath).toLowerCase() === '.m4b') {
      const file = await open(filePath, 'r');
      try {
        const { size } = await file.stat();
        parsed.chapters = await parseMp4Chapters(async (offset, length) => {
          const buffer = Buffer.alloc(length);
          const { bytesRead } = await file.read(buffer, 0, length, offset);
          return buffer.subarray(0, bytesRead);
        }, size);
      } finally {
        await file.close();
      }
    }
    return parsed;
  }

  private async parseStoredAudioMetadata(key: string, skipCovers = true): Promise<ParsedAudioMetadata> {
    const { stream, mimeType, size } = await this.storage.getFileStream(key);
    const parsed = await this.parseAudioMetadataStream(stream, { path: key, mimeType }, skipCovers);
    if (!parsed.chapters.length && extname(key).toLowerCase() === '.m4b') {
      parsed.chapters = await parseMp4Chapters(async (offset, length) => {
        const { stream: rangeStream } = await this.storage.getFileStream(key, {
          start: offset,
          end: offset + length - 1,
        });
        const chunks: Buffer[] = [];
        let bytesRead = 0;
        for await (const chunk of rangeStream) {
          if (!Buffer.isBuffer(chunk)) throw new Error('Unexpected MP4 chapter stream encoding');
          bytesRead += chunk.length;
          if (bytesRead > length) throw new Error('Storage did not honor the MP4 chapter byte range');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      }, size);
    }
    return parsed;
  }

  async parseAudioMetadataStream(
    stream: Readable,
    fileInfo: { path: string; mimeType: string },
    skipCovers = true,
  ): Promise<ParsedAudioMetadata> {
    const metadata = await parseStream(stream, fileInfo, { skipCovers, includeChapters: true });
    return this.toParsedAudioMetadata(metadata);
  }

  private toParsedAudioMetadata({ common, format }: Awaited<ReturnType<typeof parseFile>>): ParsedAudioMetadata {
    const picture = common.picture?.[0];
    const description = common.comment?.[0]?.text ?? common.description?.[0];
    const sampleRate = format.sampleRate;
    const chapters =
      sampleRate && Number.isFinite(sampleRate) && sampleRate > 0
        ? (format.chapters ?? [])
            .filter((chapter) => Number.isFinite(chapter.sampleOffset) && chapter.sampleOffset >= 0)
            .map((chapter, index) => ({
              title: chapter.title?.trim() || `Chapter ${index + 1}`,
              startTime: chapter.sampleOffset / sampleRate,
            }))
            .filter((chapter) => Number.isFinite(chapter.startTime))
            .sort((left, right) => left.startTime - right.startTime)
        : [];

    return {
      chapters,
      albumTitle: common.album,
      albumArtist: common.albumartist ?? common.artist,
      trackTitle: common.title,
      discNumber: common.disk?.no,
      trackNumber: common.track?.no,
      bookMetadata: {
        title: common.album ?? common.title,
        author: common.albumartist ?? common.artist,
        publisher: common.label?.[0] ?? common.publisher?.[0],
        publishedYear: common.year,
        summary: description,
        genres: common.genre,
        coverImageBuffer: picture ? Buffer.from(picture.data) : undefined,
        coverImageMimeType: picture?.format,
      },
    };
  }

  async previewAudioGroups(
    files: Array<{ path: string; originalname: string }>,
    relativePaths: string[],
  ): Promise<AudioGroupPreview[]> {
    if (files.length !== relativePaths.length) {
      throw new Error('Each MP3 file must have a corresponding relative path');
    }

    const groups = new Map<string, AudioGroupPreview & { ordering: Map<number, [number, number]> }>();
    for (const [index, file] of files.entries()) {
      let metadata: ParsedAudioMetadata | undefined;
      try {
        metadata = await this.parseAudioMetadata(file.path, true);
      } catch (error) {
        this.logger.warn(`Could not parse MP3 metadata for "${file.originalname}": ${String(error)}`);
      }

      const path = relativePaths[index].replace(/\\/g, '/');
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      const album = metadata?.albumTitle?.trim();
      const albumArtist = metadata?.albumArtist?.trim();
      const hasAlbumTags = Boolean(album && albumArtist);
      const groupKey = hasAlbumTags
        ? `tags:${album!.toLocaleLowerCase()}\0${albumArtist!.toLocaleLowerCase()}`
        : `folder:${folder.toLocaleLowerCase()}`;
      const fallbackName = folder.split('/').filter(Boolean).at(-1) || file.originalname.replace(/\.mp3$/i, '');
      const group = groups.get(groupKey) ?? {
        title: hasAlbumTags ? album! : fallbackName,
        author: hasAlbumTags ? albumArtist! : (metadata?.bookMetadata.author ?? ''),
        source: hasAlbumTags ? 'tags' : 'folder',
        tracks: [],
        ordering: new Map<number, [number, number]>(),
      };
      group.tracks.push({
        index,
        path,
        title: metadata?.trackTitle?.trim() || file.originalname.replace(/\.mp3$/i, ''),
      });
      group.ordering.set(index, [metadata?.discNumber ?? 0, metadata?.trackNumber ?? 0]);
      groups.set(groupKey, group);
    }

    return [...groups.values()].map(({ ordering, ...group }) => ({
      ...group,
      tracks: group.tracks.sort((left, right) => {
        const [leftDisc, leftTrack] = ordering.get(left.index) ?? [0, 0];
        const [rightDisc, rightTrack] = ordering.get(right.index) ?? [0, 0];
        if (leftDisc !== rightDisc && leftDisc && rightDisc) return leftDisc - rightDisc;
        if (leftTrack !== rightTrack && leftTrack && rightTrack) return leftTrack - rightTrack;
        return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
      }),
    }));
  }

  async updateAudioTracks(bookId: string, tracks: AudioTrack[]): Promise<void> {
    await this.formatRepository.update(
      { bookId, format: BookFormatType.MP3 },
      { audioTracks: tracks, audioChapters: [] },
    );
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
    const formatsMissingChapters = formats.filter(
      (format) =>
        (format.format === BookFormatType.MP3 || format.format === BookFormatType.M4B) && format.audioChapters == null,
    );
    if (missingFormats.length === 0 && formatsMissingChapters.length === 0) {
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
      format.externalWorkId = metadata.externalWorkId;
      format.editionId = metadata.editionId;
      format.pageCount = metadata.pageCount;
      format.publisher = metadata.publisher;
      format.language = metadata.language;
      hasUpdates = true;
    }

    for (const format of formatsMissingChapters) {
      if (format.audioTracks && format.audioTracks.length > 1) {
        format.audioChapters = [];
        hasUpdates = true;
        continue;
      }
      try {
        const { chapters } = await this.parseStoredAudioMetadata(join('books', format.fileName));
        format.audioChapters = chapters;
        hasUpdates = true;
      } catch (error) {
        this.logger.warn(`Could not parse audio chapters for "${format.fileName}": ${String(error)}`);
      }
    }

    if (!hasUpdates) {
      return bookEntity;
    }

    await this.formatRepository.save([...new Set([...missingFormats, ...formatsMissingChapters])]);
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
