import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmConfigModule } from 'src/modules/typeorm/typeorm.module';
import { BooksModule } from 'src/modules/book/book.module';
import { BookShelvesModule } from 'src/modules/book-shelf/book-shelf.module';
import { SavedPositionsModule } from 'src/modules/saved-position/saved-position.module';
import { HealthModule } from 'src/modules/health/health.module';
import { AuthorsModule } from 'src/modules/author/author.module';
import { SettingsModule } from 'src/modules/settings/settings.module';
import { OpdsModule } from 'src/modules/opds/opds.module';
import { QueueModule } from 'src/modules/queue/queue.module';
import { LibrarySyncModule } from 'src/modules/library-sync/library-sync.module';
import { JobsModule } from 'src/modules/jobs/jobs.module';
import { StorageModule } from './modules/storage/storage.module';
import LocalStorage from './modules/storage/local-storage';
import { R2Storage } from './modules/storage/r2-storage';
import { EnvironmentVariables } from './common/types/env.interface';
import { IStorageService, STORAGE_SERVICE_TOKEN } from './modules/storage/storage.interface';
import { CloudModule } from './modules/cloud/cloud.module';
import { MailModule } from 'src/modules/mail/mail.module';
import { KindleModule } from 'src/modules/kindle/kindle.module';
import { UploadsModule } from './modules/uploads/uploads.module';

@Module({
  imports: [
    // Configuration first
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),

    ScheduleModule.forRoot(),

    CloudModule,

    HealthModule,

    // Queue infrastructure
    QueueModule,

    // Database configuration
    TypeOrmConfigModule,

    // Feature modules
    BooksModule,
    BookShelvesModule,
    SavedPositionsModule,
    AuthorsModule,
    SettingsModule,
    OpdsModule,
    LibrarySyncModule,
    JobsModule,
    StorageModule,
    UploadsModule,
    MailModule,
    KindleModule,
  ],
  controllers: [],
  providers: [
    {
      provide: STORAGE_SERVICE_TOKEN,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<EnvironmentVariables>): IStorageService => {
        const useLocalStorage = configService.get<'local' | 'r2'>('STORAGE_LOCATION', 'local') === 'local';
        if (useLocalStorage) {
          return new LocalStorage(configService);
        } else {
          return new R2Storage(configService);
        }
      },
    },
  ],
})
export class AppModule {}
