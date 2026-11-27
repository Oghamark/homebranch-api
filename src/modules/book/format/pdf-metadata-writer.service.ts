import { Inject, Injectable, Logger } from '@nestjs/common';
import { PDFDocument } from 'pdf-lib';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../../storage/storage.interface';

@Injectable()
export class PdfMetadataWriterService {
  private readonly logger = new Logger(PdfMetadataWriterService.name);

  constructor(@Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService) {}

  async writeMetadata(pdfPath: string, metadata: SyncableMetadata): Promise<void> {
    try {
      const { buffer } = await this.storage.getFileBuffer(pdfPath);
      const pdf = await PDFDocument.load(buffer);
      if (metadata.title) pdf.setTitle(metadata.title);
      if (metadata.author) pdf.setAuthor(metadata.author);
      if (metadata.summary) pdf.setSubject(metadata.summary);
      if (metadata.publisher) pdf.setProducer(metadata.publisher);
      if (metadata.publishedYear) pdf.setCreationDate(new Date(Date.UTC(metadata.publishedYear, 0, 1)));
      if (metadata.genres?.length) pdf.setKeywords(metadata.genres);

      const modified = await pdf.save();
      await this.storage.uploadFile(Buffer.from(modified), {
        key: pdfPath,
        mimeType: 'application/pdf',
      });
    } catch (error) {
      this.logger.error(`Failed to write metadata to PDF: ${String(error)}`);
      throw error;
    }
  }
}
