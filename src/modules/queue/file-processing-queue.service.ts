import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';

export interface FileProcessingJobResult {
  jobId: string | undefined;
}

@Injectable()
export class FileProcessingQueueService {
  constructor(@InjectQueue('file-processing') private readonly fileProcessingQueue: Queue) {}

  async enqueueMetadataSync(
    bookId: string,
    fileName: string,
    filePath: string,
    options?: { jobId?: string; preferredDbFields?: (keyof SyncableMetadata)[] },
  ): Promise<FileProcessingJobResult> {
    const job = await this.fileProcessingQueue.add(
      'sync-metadata',
      { bookId, fileName, filePath, preferredDbFields: options?.preferredDbFields },
      { jobId: options?.jobId, removeOnComplete: 100, removeOnFail: 50 },
    );
    return { jobId: job.id };
  }
}
