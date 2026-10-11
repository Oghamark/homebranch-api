import {
  ensureDir,
  ensureDirSync,
  remove,
  stat,
  writeFile,
  createReadStream,
  existsSync,
  readdir,
  rename,
  move,
} from 'fs-extra';
import { dirname, join, normalize } from 'path';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IStorageService } from './storage.interface';
import {
  StorageUploadOptions,
  StorageUploadResult,
  StorageStreamResult,
  StorageFileItem,
  FileBufferResult,
  StorageFileStats,
  StorageByteRange,
} from './storage.types';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../../common/types/env.interface';
import { readFile } from 'fs/promises';

@Injectable()
class LocalStorage implements IStorageService {
  private readonly baseDir: string;
  private readonly appUrl: string;
  private readonly logger: Logger;

  constructor(private readonly configService: ConfigService<EnvironmentVariables>) {
    this.baseDir = this.configService.get('UPLOADS_DIRECTORY', 'uploads');
    this.appUrl = this.configService.get('APP_URL', 'http://localhost:3000');
    this.logger = new Logger('Local Storage');
    ensureDirSync(this.baseDir);
  }

  /**
   * Translates a storage key into a safe, absolute physical disk path.
   * Prevents directory traversal attacks (e.g., key looking like "../../../etc/passwd")
   */
  private getAbsolutePath(key: string): string {
    const safeKey = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return join(this.baseDir, safeKey);
  }

  async uploadFile(fileBuffer: Buffer, options: StorageUploadOptions): Promise<StorageUploadResult> {
    this.logger.log(`Uploading file`);
    const fullPath = this.getAbsolutePath(options.key);

    // Ensure nested folders exist
    await ensureDir(dirname(fullPath));

    // write binary to disk
    await writeFile(fullPath, fileBuffer);

    return {
      key: options.key,
      url: `${this.appUrl}/uploads/${options.key}`,
    };
  }

  async uploadFileFromPath(filePath: string, options: StorageUploadOptions): Promise<StorageUploadResult> {
    this.logger.log(`Uploading file from path`);
    const fullPath = this.getAbsolutePath(options.key);

    // Ensure nested folders exist
    await ensureDir(dirname(fullPath));

    // move file to destination
    await move(filePath, fullPath, { overwrite: true });

    return {
      key: options.key,
      url: `${this.appUrl}/uploads/${options.key}`,
    };
  }

  async moveFile(key: string, destinationKey: string): Promise<void> {
    this.logger.log(`Moving file ${key} to ${destinationKey}`);
    const fullPath = this.getAbsolutePath(key);
    const fullDestinationPath = this.getAbsolutePath(destinationKey);

    if (existsSync(fullPath)) {
      await rename(fullPath, fullDestinationPath);
    }
  }

  async getFileStream(key: string, range?: StorageByteRange): Promise<StorageStreamResult> {
    this.logger.log(`Getting file stream for ${key}`);
    const fullPath = this.getAbsolutePath(key);

    if (!existsSync(fullPath)) {
      throw new NotFoundException('Requested file not found in local storage');
    }

    const stats = await stat(fullPath);
    const stream = createReadStream(fullPath, range ? { start: range.start, end: range.end } : undefined);

    // look up or estimate mime-type based on file extension if options missed it
    let mimeType = 'application/octet-stream';
    if (key.endsWith('.epub')) mimeType = 'application/epub+zip';
    if (key.endsWith('.pdf')) mimeType = 'application/pdf';
    if (key.endsWith('.mp3')) mimeType = 'audio/mpeg';
    if (key.endsWith('.m4b')) mimeType = 'audio/mp4';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg')) mimeType = 'image/jpeg';
    if (key.endsWith('.png')) mimeType = 'image/png';

    return {
      stream,
      mimeType,
      size: stats.size,
      contentRange: range ? `bytes ${range.start}-${range.end}/${stats.size}` : undefined,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getDownloadUrl(key: string, _expiresIn?: number): Promise<string> {
    this.logger.log(`Getting download URL for ${key}`);
    // Local files don't support true Cloudflare-style expiring signed URLs.
    // Instead, we just return the local proxy URL.
    // Secure access can be handled inside the NestJS controller route guard instead!
    return Promise.resolve(`${this.appUrl}/uploads/${key}`);
  }

  async deleteFile(key: string): Promise<void> {
    this.logger.log('Deleting file ${key}');
    const fullPath = this.getAbsolutePath(key);
    if (existsSync(fullPath)) {
      await remove(fullPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    this.logger.log(`Checking if ${key} exists`);
    const fullPath = this.getAbsolutePath(key);
    return Promise.resolve(existsSync(fullPath));
  }

  async listFiles(prefix: string = '', recursive: boolean = false): Promise<StorageFileItem[]> {
    this.logger.log('Listing files');
    const targetDir = this.getAbsolutePath(prefix);
    const results: StorageFileItem[] = [];

    // If the folder does not exist yet, return an empty array safely
    if (!existsSync(targetDir)) {
      return [];
    }

    // Read everything inside the target directory
    const items = await readdir(targetDir, { withFileTypes: true });

    for (const item of items) {
      // Build the storage-friendly relative key path
      const itemRelativeKey = join(prefix, item.name).replace(/\\/g, '/');
      const itemFullPath = join(targetDir, item.name);

      if (item.isFile()) {
        const stats = await stat(itemFullPath);
        results.push({
          key: itemRelativeKey,
          fileName: item.name,
          size: stats.size,
          updatedAt: stats.mtime,
        });
      } else if (item.isDirectory() && recursive) {
        // If recursive is true, dive into the folder and merge the results
        const subFolderFiles = await this.listFiles(itemRelativeKey, true);
        results.push(...subFolderFiles);
      }
    }

    return results;
  }

  async getFileBuffer(key: string): Promise<FileBufferResult> {
    this.logger.log(`Getting file buffer for ${key}`);
    const fullPath = this.getAbsolutePath(key);

    if (!existsSync(fullPath)) {
      throw new NotFoundException('Requested file not found in local storage');
    }

    const buffer = await readFile(fullPath);

    return {
      key: key,
      buffer: buffer,
    };
  }

  async getFileStats(key: string): Promise<StorageFileStats> {
    this.logger.log(`Getting file stats for ${key}`);
    const fullPath = this.getAbsolutePath(key);

    if (!existsSync(fullPath)) {
      throw new NotFoundException('Requested file not found in local storage');
    }

    const stats = await stat(fullPath);

    return {
      size: stats.size,
      mtimeMs: stats.mtimeMs,
    };
  }
}

export default LocalStorage;
