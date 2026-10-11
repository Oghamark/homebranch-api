import { Readable } from 'stream';

export interface StorageUploadOptions {
  key: string; // Destination path (e.g., "books/123/book.epub")
  mimeType: string; // e.g., "application/epub+zip", "image/jpeg"
  size?: number; // File size in bytes
}

export interface StorageUploadResult {
  key: string; // Confirmed storage path
  url: string; // Direct URL or proxy path
}

export interface StorageStreamResult {
  stream: Readable;
  mimeType: string;
  size: number;
  contentRange?: string;
}

export interface StorageByteRange {
  start: number;
  end: number;
}

export interface StorageFileItem {
  key: string; // Path to the file
  fileName: string;
  size: number; // Size in bytes
  updatedAt: Date; // Last modified date
}

export interface FileBufferResult {
  key: string;
  buffer: Buffer;
}

export interface StorageFileStats {
  size: number;
  mtimeMs: number;
}
