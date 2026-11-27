import { Module } from '@nestjs/common';
import { BookCreationService } from 'src/modules/book/catalog/book-creation.service';
import { BookController } from 'src/modules/book/catalog/book.controller';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookCoreModule } from 'src/modules/book/book-core.module';
import { BookPublicationModule } from 'src/modules/book/publication/book-publication.module';
import { StorageModule } from '../storage/storage.module';
import { BookDuplicateController } from './deduplication/book-duplicate.controller';
import { BookDuplicateService } from './deduplication/book-duplicate.service';
import { BookDuplicatePersistenceService } from './deduplication/book-duplicate.persistence';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookDuplicateEntity } from './deduplication/book-duplicate.entity';
import { BookDuplicateRegistrationService } from './deduplication/book-duplicate-registration.service';
import { DuplicateScanQueueService } from './deduplication/duplicate-scan-queue.service';
import { DuplicateScanSchedulerService } from './deduplication/duplicate-scan-scheduler.service';
import { DuplicateScanProcessor } from './deduplication/duplicate-scan.processor';
import { BullModule } from '@nestjs/bullmq';
import { BookShelvesModule } from 'src/modules/book-shelf/book-shelf.module';
import { BulkBookController } from './bulk/bulk-book.controller';
import { BulkBookService } from './bulk/bulk-book.service';
import { UploadsModule } from '../uploads/uploads.module';
import { UploadedBooksController } from './catalog/uploaded-books.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookDuplicateEntity]),
    AuthModule,
    BookCoreModule,
    BookShelvesModule,
    BookPublicationModule,
    StorageModule,
    UploadsModule,
    BullModule.registerQueue({ name: 'duplicate-scan' }),
  ],
  providers: [
    BookDuplicatePersistenceService,
    BookDuplicateRegistrationService,
    BookDuplicateService,
    DuplicateScanQueueService,
    DuplicateScanSchedulerService,
    DuplicateScanProcessor,
    BookCreationService,
    BulkBookService,
  ],
  controllers: [BulkBookController, BookDuplicateController, UploadedBooksController, BookController],
})
export class BooksModule {}
