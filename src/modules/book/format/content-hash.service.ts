import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import * as AdmZip from 'adm-zip';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';
import { createReadStream } from 'fs-extra';

@Injectable()
export class ContentHashService {
  private readonly logger = new Logger(ContentHashService.name);

  constructor(@Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService) {}

  async computeHash(key: string): Promise<string> {
    if (key.toLowerCase().endsWith('.epub')) {
      const { buffer } = await this.storage.getFileBuffer(key);
      return this.computeHashFromBuffer(buffer, key);
    }
    const { stream } = await this.storage.getFileStream(key);
    return this.computeHashFromStream(stream);
  }

  async computeHashFromPath(filePath: string): Promise<string> {
    if (filePath.toLowerCase().endsWith('.epub')) {
      try {
        return this.computeEpubContentHashFromPath(filePath);
      } catch (err) {
        this.logger.warn(`Failed to parse epub for content hash, falling back to file hash: ${err}`);
      }
    }
    return this.computeFileHash(filePath);
  }

  computeHashFromBuffer(buffer: Buffer, fileName: string): string {
    if (fileName.toLowerCase().endsWith('.epub')) {
      try {
        return this.computeEpubContentHash(buffer);
      } catch (err) {
        this.logger.warn(`Failed to parse epub for content hash, falling back to file hash: ${err}`);
      }
    }
    return this.computeBufferHash(buffer);
  }

  private computeBufferHash(buffer: Buffer): string {
    const hash = createHash('sha256');
    hash.update(buffer);
    return hash.digest('hex');
  }

  private computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      const stream = createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private computeHashFromStream(stream: NodeJS.ReadableStream): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256');
      stream.on('data', (data: Buffer) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  private computeEpubContentHashFromPath(filePath: string): string {
    const zip = new AdmZip(filePath);
    return this.computeEpubContentHash(zip);
  }

  /**
   * Hashes only the chapter content files listed in the epub spine, in spine
   * order. This ensures two epubs of the same book with different embedded
   * metadata (title, summary, cover, etc.) produce the same hash.
   */
  private computeEpubContentHash(buffer: Buffer | AdmZip): string {
    const zip = buffer instanceof AdmZip ? buffer : new AdmZip(buffer);

    // 1. Locate the OPF file via META-INF/container.xml
    const containerEntry = zip.getEntry('META-INF/container.xml');
    if (!containerEntry) throw new Error('No META-INF/container.xml');
    const containerXml = containerEntry.getData().toString('utf8');
    const opfPathMatch = containerXml.match(/full-path="([^"]+\.opf)"/i);
    if (!opfPathMatch) throw new Error('Could not locate OPF file');
    const opfPath = opfPathMatch[1];

    // 2. Parse the OPF to build a manifest (id → href) and read the spine order
    const opfEntry = zip.getEntry(opfPath);
    if (!opfEntry) throw new Error(`OPF file not found: ${opfPath}`);
    const opfXml = opfEntry.getData().toString('utf8');
    const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

    // Build manifest: id → resolved href (content items only)
    // Extract each attribute independently to avoid dependency on attribute order
    const manifest = new Map<string, string>();
    const itemRegex = /<item\s([^>]+)\/>/g;
    let match: RegExpExecArray | null;
    while ((match = itemRegex.exec(opfXml)) !== null) {
      const attrs = match[1];
      const idMatch = /\bid="([^"]+)"/.exec(attrs);
      const hrefMatch = /\bhref="([^"]+)"/.exec(attrs);
      const mediaTypeMatch = /\bmedia-type="([^"]+)"/.exec(attrs);
      if (!idMatch || !hrefMatch || !mediaTypeMatch) continue;
      const [, id] = idMatch;
      const [, href] = hrefMatch;
      const [, mediaType] = mediaTypeMatch;
      if (mediaType.includes('xhtml') || mediaType.includes('html')) {
        manifest.set(id, opfDir + href);
      }
    }

    // Read spine item refs in order
    const spineMatch = opfXml.match(/<spine[^>]*>([\s\S]*?)<\/spine>/i);
    if (!spineMatch) throw new Error('No <spine> found in OPF');
    const spineItems: string[] = [];
    const itemrefRegex = /<itemref\s[^>]*\bidref="([^"]+)"/g;
    while ((match = itemrefRegex.exec(spineMatch[1])) !== null) {
      const href = manifest.get(match[1]);
      if (href) spineItems.push(href);
    }

    if (spineItems.length === 0) throw new Error('Empty spine');

    // 3. Hash the content of all spine items in order
    const hash = createHash('sha256');
    for (const href of spineItems) {
      const entry = zip.getEntry(href) ?? zip.getEntry(decodeURIComponent(href));
      if (!entry) {
        this.logger.warn(`Spine item not found in epub zip: ${href}`);
        continue;
      }
      hash.update(entry.getData());
    }
    return hash.digest('hex');
  }
}
