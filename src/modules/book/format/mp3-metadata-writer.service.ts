import { Inject, Injectable, Logger } from '@nestjs/common';
import * as NodeID3 from 'node-id3';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

@Injectable()
export class Mp3MetadataWriterService {
  private readonly logger = new Logger(Mp3MetadataWriterService.name);

  constructor(@Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService) {}

  async writeMetadata(mp3Path: string, metadata: SyncableMetadata): Promise<void> {
    try {
      const { buffer } = await this.storage.getFileBuffer(mp3Path);
      const tags: NodeID3.Tags = {
        title: metadata.title,
        artist: metadata.author,
        album: metadata.title,
        year: metadata.publishedYear ? String(metadata.publishedYear) : undefined,
        genre: metadata.genres?.join(', '),
        publisher: metadata.publisher,
        comment: metadata.summary ? { language: 'eng', text: metadata.summary } : undefined,
        userDefinedText: metadata.isbn ? [{ description: 'ISBN', value: metadata.isbn }] : undefined,
      };
      const modified = NodeID3.write(tags, buffer);
      if (!(modified instanceof Buffer)) {
        throw modified instanceof Error ? modified : new Error('MP3 tag writer returned no buffer');
      }
      await this.storage.uploadFile(modified, {
        key: mp3Path,
        mimeType: 'audio/mpeg',
      });
    } catch (error) {
      this.logger.error(`Failed to write metadata to MP3: ${String(error)}`);
      throw error;
    }
  }
}
