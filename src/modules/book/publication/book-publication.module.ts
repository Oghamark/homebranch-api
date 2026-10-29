import { Module } from '@nestjs/common';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookCoreModule } from 'src/modules/book/book-core.module';
import { BookPublicationService } from 'src/modules/book/publication/book-publication.service';
import { EpubManifestService } from 'src/modules/book/publication/epub-manifest.service';
import { EpubContentService } from 'src/modules/book/publication/epub-content.service';
import { BookPublicationController } from 'src/modules/book/publication/book-publication.controller';
import { StorageModule } from '../../storage/storage.module';
import { EpubArchiveCacheService } from 'src/modules/book/publication/epub-archive-cache.service';
import { EpubLocationService } from './epub-location.service';

@Module({
  imports: [AuthModule, BookCoreModule, StorageModule],
  providers: [
    BookPublicationService,
    EpubManifestService,
    EpubContentService,
    EpubArchiveCacheService,
    EpubLocationService,
  ],
  controllers: [BookPublicationController],
  exports: [EpubManifestService, EpubLocationService],
})
export class BookPublicationModule {}
