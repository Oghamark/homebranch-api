import { Module } from '@nestjs/common';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { OpenLibraryGateway } from 'src/common/gateways/open-library.gateway';
import { GoogleBooksGateway } from 'src/common/gateways/google-books.gateway';
import { CompositeMetadataGateway } from 'src/modules/book/metadata/gateways/composite-metadata.gateway';
import { CompositeSummaryGateway } from 'src/modules/book/metadata/gateways/composite-summary.gateway';
import { MetadataSchedulerService } from 'src/modules/book/metadata/metadata-scheduler.service';
import { BookPersistenceModule } from 'src/modules/book/persistence/book-persistence.module';

@Module({
  imports: [SettingsModule, BookPersistenceModule],
  providers: [
    OpenLibraryGateway,
    GoogleBooksGateway,
    CompositeMetadataGateway,
    CompositeSummaryGateway,
    MetadataSchedulerService,
  ],
  exports: [CompositeMetadataGateway, CompositeSummaryGateway, OpenLibraryGateway],
})
export class BookMetadataModule {}
