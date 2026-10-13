import { extname } from 'path';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';

export interface BookFormatDefinition {
  format: BookFormatType;
  extension: string;
  mediaType: string;
  preferenceOrder: number;
  supportsManifest: boolean;
  supportsContentEntries: boolean;
  supportsMetadataWrite: boolean;
}

const BOOK_FORMAT_DEFINITIONS: BookFormatDefinition[] = [
  {
    format: BookFormatType.EPUB,
    extension: '.epub',
    mediaType: 'application/epub+zip',
    preferenceOrder: 0,
    supportsManifest: true,
    supportsContentEntries: true,
    supportsMetadataWrite: true,
  },
  {
    format: BookFormatType.PDF,
    extension: '.pdf',
    mediaType: 'application/pdf',
    preferenceOrder: 1,
    supportsManifest: false,
    supportsContentEntries: false,
    supportsMetadataWrite: false,
  },
  {
    format: BookFormatType.MP3,
    extension: '.mp3',
    mediaType: 'audio/mpeg',
    preferenceOrder: 3,
    supportsManifest: false,
    supportsContentEntries: false,
    supportsMetadataWrite: false,
  },
  {
    format: BookFormatType.M4B,
    extension: '.m4b',
    mediaType: 'audio/mp4',
    preferenceOrder: 2,
    supportsManifest: false,
    supportsContentEntries: false,
    supportsMetadataWrite: false,
  },
];

const BOOK_FORMAT_DEFINITION_MAP = new Map<BookFormatType, BookFormatDefinition>(
  BOOK_FORMAT_DEFINITIONS.map((definition) => [definition.format, definition]),
);

const BOOK_FORMAT_EXTENSION_MAP = new Map<string, BookFormatType>(
  BOOK_FORMAT_DEFINITIONS.map((definition) => [definition.extension, definition.format]),
);

export function getSupportedBookFormatDefinitions(): BookFormatDefinition[] {
  return BOOK_FORMAT_DEFINITIONS;
}

export function getBookFormatDefinition(format: BookFormatType): BookFormatDefinition {
  const definition = BOOK_FORMAT_DEFINITION_MAP.get(format);
  if (!definition) {
    throw new Error(`Unsupported book format: ${format}`);
  }
  return definition;
}

export function detectBookFormatFromFileName(fileName: string): BookFormatType | undefined {
  return BOOK_FORMAT_EXTENSION_MAP.get(extname(fileName).toLowerCase());
}

export function isSupportedBookFile(fileName: string): boolean {
  return detectBookFormatFromFileName(fileName) !== undefined;
}

export function getBookFormatExtension(format: BookFormatType): string {
  return getBookFormatDefinition(format).extension;
}

export function getBookFormatMediaType(format: BookFormatType): string {
  return getBookFormatDefinition(format).mediaType;
}

export function supportsBookFormatManifest(format: BookFormatType): boolean {
  return getBookFormatDefinition(format).supportsManifest;
}

export function supportsBookFormatContentEntries(format: BookFormatType): boolean {
  return getBookFormatDefinition(format).supportsContentEntries;
}

export function supportsBookFormatMetadataWrite(format: BookFormatType): boolean {
  return getBookFormatDefinition(format).supportsMetadataWrite;
}

export function getDefaultBookFormatType(): BookFormatType {
  return [...BOOK_FORMAT_DEFINITIONS].sort((left, right) => left.preferenceOrder - right.preferenceOrder)[0].format;
}

export function getPreferredBookFormat(formats?: BookFormatEntity[]): BookFormatEntity | undefined {
  if (!formats?.length) return undefined;
  return [...formats].sort(
    (left, right) =>
      getBookFormatDefinition(left.format).preferenceOrder - getBookFormatDefinition(right.format).preferenceOrder,
  )[0];
}

export function getRequestedBookFormat(
  formats: BookFormatEntity[] | undefined,
  requestedFormat?: BookFormatType,
): BookFormatEntity | undefined {
  if (!formats?.length) return undefined;
  if (requestedFormat) {
    return formats.find((format) => format.format === requestedFormat);
  }
  return getPreferredBookFormat(formats);
}

export function getRequestedBookFormatFromBook(
  book: { formats?: BookFormatEntity[]; fileName: string; fileMtime?: number; fileContentHash?: string },
  requestedFormat?: BookFormatType,
): BookFormatEntity | undefined {
  return getRequestedBookFormat(book.formats, requestedFormat);
}

export function getAvailableBookFormatsFromBook(book: {
  formats?: BookFormatEntity[];
  fileName: string;
  fileMtime?: number;
  fileContentHash?: string;
}): BookFormatEntity[] {
  return book.formats ?? [];
}

export function getBookFormatByFileName(
  book: { formats?: BookFormatEntity[]; fileName: string; fileMtime?: number; fileContentHash?: string },
  fileName: string,
): BookFormatEntity | undefined {
  return getAvailableBookFormatsFromBook(book).find((format) => format.fileName === fileName);
}
