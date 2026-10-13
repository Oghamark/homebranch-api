import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import * as chokidar from 'chokidar';
import { basename, join, relative } from 'path';
import { isSupportedBookFile } from 'src/modules/book/format/book-format';

@Injectable()
export class FileWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private watcher: chokidar.FSWatcher | null = null;
  private readonly uploadsDirectory: string;
  private readonly booksDirectory: string;
  // Debounce map: filePath → timeout handle for stability detection
  private readonly pendingFiles = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly STABILITY_DELAY_MS = 3000;

  constructor(@InjectQueue('library-scan') private readonly libraryScanQueue: Queue) {
    this.uploadsDirectory = process.env.UPLOADS_DIRECTORY || './uploads';
    this.booksDirectory = join(this.uploadsDirectory, 'books');
  }

  async onModuleInit() {
    const storageLocation = (process.env.STORAGE_LOCATION || 'local').toLowerCase();
    const enableWatcher = (process.env.ENABLE_FILE_WATCHER || 'true').toLowerCase() !== 'false';

    if (storageLocation !== 'local') {
      this.logger.log(`FileWatcher disabled because STORAGE_LOCATION=${storageLocation}`);
      return;
    }

    if (process.env.CLOUD_MODE === 'true') {
      this.logger.log('FileWatcher disabled in CLOUD_MODE');
      return;
    }

    if (!enableWatcher) {
      this.logger.log('FileWatcher disabled by ENABLE_FILE_WATCHER=false');
      return;
    }

    this.logger.log(`Starting file watcher on ${this.booksDirectory}`);

    this.watcher = chokidar.watch(this.booksDirectory, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: FileWatcherService.STABILITY_DELAY_MS,
        pollInterval: 500,
      },
      ignored: [/(^|[/\\])\../, /\.tmp-/, /[/\\]audiobook-tracks[/\\]/], // Ignore dotfiles, temporary files, and audiobook tracks
    });

    this.watcher.on('add', (filePath: string) => void this.onFileAdded(filePath));
    this.watcher.on('change', (filePath: string) => void this.onFileChanged(filePath));
    this.watcher.on('unlink', (filePath: string) => void this.onFileRemoved(filePath));
    this.watcher.on('error', (error: Error) => {
      this.logger.error(`File watcher error: ${error.message}`);
    });

    // Run an initial scan on startup
    await this.enqueueScan('startup');
  }

  async onModuleDestroy() {
    for (const timeout of this.pendingFiles.values()) {
      clearTimeout(timeout);
    }
    this.pendingFiles.clear();

    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  async enqueueScan(trigger: string) {
    await this.libraryScanQueue.add(
      'scan-directory',
      { trigger, booksDirectory: this.booksDirectory },
      { jobId: `scan-${trigger}-${Date.now()}`, removeOnComplete: 100, removeOnFail: 50 },
    );
  }

  private async onFileAdded(filePath: string) {
    if (!isSupportedBookFile(filePath)) {
      this.logger.debug(`Ignoring unsupported book file: ${filePath}`);
      return;
    }
    this.logger.log(`New file detected: ${filePath}`);
    await this.enqueueFileProcessing(filePath, 'add');
  }

  private async onFileChanged(filePath: string) {
    if (!isSupportedBookFile(filePath)) return;
    this.logger.log(`File changed: ${filePath}`);
    await this.enqueueFileProcessing(filePath, 'change');
  }

  private async onFileRemoved(filePath: string) {
    if (!isSupportedBookFile(filePath)) return;
    this.logger.log(`File removed: ${filePath}`);

    const fileName = basename(filePath);
    const storageKey = this.toStorageKey(filePath);
    await this.libraryScanQueue.add(
      'file-removed',
      { fileName, filePath: storageKey },
      { removeOnComplete: 100, removeOnFail: 50 },
    );
  }

  private async enqueueFileProcessing(filePath: string, event: string) {
    const fileName = basename(filePath);
    const storageKey = this.toStorageKey(filePath);
    await this.libraryScanQueue.add(
      'process-file',
      { fileName, filePath: storageKey, event },
      {
        jobId: `process-${fileName}-${Date.now()}`,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
  }

  private toStorageKey(filePath: string): string {
    return join('books', relative(this.booksDirectory, filePath)).replace(/\\/g, '/');
  }
}
