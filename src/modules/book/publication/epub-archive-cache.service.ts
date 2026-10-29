import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import * as AdmZip from 'adm-zip';
import { IStorageService, STORAGE_SERVICE_TOKEN } from 'src/modules/storage/storage.interface';

type AdmZipArchive = InstanceType<typeof AdmZip>;

type CachedEpubArchive = {
  key: string;
  mtimeMs: number;
  size: number;
  etag?: string;
  zip: AdmZipArchive;
  lastAccessedAt: number;
};

@Injectable()
export class EpubArchiveCacheService {
  private readonly maxEntries = 16;
  private readonly maxBytes = 128 * 1024 * 1024;
  private readonly cache = new Map<string, CachedEpubArchive>();
  private cachedBytes = 0;

  constructor(@Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService) {}

  async getArchive(key: string): Promise<AdmZipArchive> {
    const stats = await this.storage.getFileStats(key);
    const cached = this.cache.get(key);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size && cached.etag === stats.etag) {
      cached.lastAccessedAt = Date.now();
      return cached.zip;
    }

    if (cached) {
      this.remove(key);
    }

    if (stats.size > 64 * 1024 * 1024) throw new BadRequestException('EPUB archive size limit exceeded');
    const { buffer } = await this.storage.getFileBuffer(key);
    const after = await this.storage.getFileStats(key);
    if (
      buffer.length !== stats.size ||
      after.size !== stats.size ||
      after.mtimeMs !== stats.mtimeMs ||
      after.etag !== stats.etag
    ) {
      throw new ServiceUnavailableException('EPUB changed while loading; retry');
    }
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (
      entries.length > 4096 ||
      entries.reduce((sum, entry) => sum + entry.header.size, 0) > 64 * 1024 * 1024 ||
      new Set(entries.map((entry) => entry.entryName)).size !== entries.length
    ) {
      throw new BadRequestException('EPUB archive expansion limit exceeded or duplicate entries');
    }
    this.add({
      key,
      mtimeMs: stats.mtimeMs,
      size: buffer.byteLength,
      etag: stats.etag,
      zip,
      lastAccessedAt: Date.now(),
    });
    return zip;
  }

  private add(entry: CachedEpubArchive): void {
    if (entry.size > this.maxBytes) {
      return;
    }

    this.cache.set(entry.key, entry);
    this.cachedBytes += entry.size;
    this.evictOverflow();
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxEntries || this.cachedBytes > this.maxBytes) {
      const oldest = [...this.cache.values()].sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)[0];
      if (!oldest) {
        return;
      }
      this.remove(oldest.key);
    }
  }

  private remove(key: string): void {
    const cached = this.cache.get(key);
    if (!cached) {
      return;
    }
    this.cachedBytes -= cached.size;
    this.cache.delete(key);
  }
}
