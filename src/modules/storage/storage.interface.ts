import {
  StorageUploadOptions,
  StorageUploadResult,
  StorageStreamResult,
  StorageFileItem,
  FileBufferResult,
  StorageFileStats,
  StorageByteRange,
} from './storage.types';

export interface IStorageService {
  /**
   * Uploads a file (EPUB, PDF, or Cover Image) to the storage provider.
   */
  uploadFile(fileBuffer: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult>;

  /**
   * Uploads a file from a local path.
   */
  uploadFileFromPath(filePath: string, options: StorageUploadOptions): Promise<StorageUploadResult>;

  /**
   * Moves a file to a target destination
   * @param key - source file to move
   * @param destinationKey - final location of file
   */
  moveFile(key: string, destinationKey: string): Promise<void>;

  /**
   * Gets a readable stream of the file along with its metadata.
   * Crucial for proxying books directly to the in-browser reader.
   */
  getFileStream(key: string, range?: StorageByteRange): Promise<StorageStreamResult>;

  /**
   * Generates a temporary, secure URL for file access.
   * Useful for offloading large PDF downloads directly to
   * Cloudflare R2.
   *
   * @param key
   * @param expiresIn Time in seconds until the link expires (default: 3600)
   */
  getDownloadUrl(key: string, expiresIn?: number): Promise<string>;

  /**
   * Deletes a file from storage. Used when removing books from the library.
   */
  deleteFile(key: string): Promise<void>;

  /**
   * Checks if a file exists. Useful for verifying book uploads or covers.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Lists all files under a specific folder prefix
   *
   * @param prefix The directory path to scan (e.g., "books/123" or "covers")
   * @param recursive If true, finds files inside nested subfolders too
   */
  listFiles(prefix?: string, recursive?: boolean): Promise<StorageFileItem[]>;

  /**
   * Gets the buffer of a file
   * @param key
   */
  getFileBuffer(key: string): Promise<FileBufferResult>;

  /**
   * Gets the stats of a file
   * @param key
   */
  getFileStats(key: string): Promise<StorageFileStats>;
}

/**
 * Injection token used to bind this interface to a concrete provider
 * (R2 or Local Storage) inside NestJS modules.
 */
export const STORAGE_SERVICE_TOKEN = Symbol('IStorageService');
