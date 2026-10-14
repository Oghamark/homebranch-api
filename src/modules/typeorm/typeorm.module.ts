import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { UserBookFavoriteEntity } from 'src/modules/book/user-book-favorite.entity';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { AuthorEntity } from 'src/modules/author/author.entity';
import { SettingEntity } from 'src/modules/settings/setting.entity';
import { SchemaUpdate1755566512418 } from 'src/migrations/1755566512418-schema-update';
import { AddUserAndRoleTables1739836800000 } from 'src/migrations/1739836800000-AddUserAndRoleTables';
import { SeedAdminRole1739836800001 } from 'src/migrations/1739836800001-SeedAdminRole';
import { AddSavedPositionsTable1755566512419 } from 'src/migrations/1755566512419-AddSavedPositionsTable';
import { AddPercentageToSavedPosition1755566512420 } from 'src/migrations/1755566512420-AddPercentageToSavedPosition';
import { AddAuthorTable1740614850000 } from 'src/migrations/1740614850000-AddAuthorTable';
import { AddSummaryToBook1755566512421 } from 'src/migrations/1755566512421-AddSummaryToBook';
import { RemoveUserAndRoleTables1760000000000 } from 'src/migrations/1760000000000-RemoveUserAndRoleTables';
import { AddUploadedByUserIdToBook1767225600000 } from 'src/migrations/1767225600000-AddUploadedByUserIdToBook';
import { AddCreatedByUserIdToBookShelf1772317868306 } from 'src/migrations/1772317868306-AddCreatedByUserIdToBookShelf';
import { AddBookMetadataFields1772395519432 } from 'src/migrations/1772395519432-AddBookMetadataFields';
import { CreateSettingTable1772669702941 } from 'src/migrations/1772669702941-CreateSettingTable';
import { AddCreatedAtToBook1772681032915 } from 'src/migrations/1772681032915-AddCreatedAtToBook';
import { AddUserBookFavoriteTable1773439568621 } from 'src/migrations/1773439568621-AddUserBookFavoriteTable';
import { AddSyncAndSoftDeleteFields1773287271444 } from 'src/migrations/1773287271444-AddSyncAndSoftDeleteFields';
import { BookDuplicateEntity } from 'src/modules/book/deduplication/book-duplicate.entity';
import { AddBookDuplicateTable1773801937488 } from 'src/migrations/1773801937488-AddBookDuplicateTable';
import { AddBookFormatTable1774652732886 } from 'src/migrations/1774652732886-AddBookFormatTable';
import { AddMetadataToBookFormat1777224804830 } from 'src/migrations/1777224804830-AddMetadataToBookFormat';
import { BackfillLegacyBookFormats1777228301570 } from 'src/migrations/1777228301570-BackfillLegacyBookFormats';
import { AddFileSizeToBookFormat1790000000000 } from 'src/migrations/1790000000000-AddFileSizeToBookFormat';
import { CreateUserPreferenceTable1790000000001 } from 'src/migrations/1790000000001-CreateUserPreferenceTable';
import { UserPreferenceEntity } from 'src/modules/kindle/user-preference.entity';
import { AddAudioTracksToBookFormat1790000000002 } from 'src/migrations/1790000000002-AddAudioTracksToBookFormat';
import { CreateBookClubCore1790000000003 } from 'src/migrations/1790000000003-CreateBookClubCore';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { CreateBookClubReadingCopy1790000000004 } from 'src/migrations/1790000000004-CreateBookClubReadingCopy';
import { AddBookClubWorkMatching1790000000005 } from 'src/migrations/1790000000005-AddBookClubWorkMatching';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const logger = new Logger('TypeOrmModule');

        // Validate required environment variables
        const username = configService.get<string>('DATABASE_USERNAME');
        const password = configService.get<string>('DATABASE_PASSWORD');
        const host = configService.get<string>('DATABASE_HOST', 'localhost');
        const port = configService.get<number>('DATABASE_PORT', 5432);
        const database = configService.get<string>('DATABASE_NAME', 'homebranch');

        logger.log(`Connecting to ${database} at ${host}:${port}`);

        if (!username || !password) {
          throw new Error(`Missing database credentials. ` + `USERNAME: ${!!username}, PASSWORD: ${!!password}`);
        }

        return {
          type: 'postgres',
          host: host,
          port: port,
          username: username,
          password: password,
          database: database,
          entities: [
            BookEntity,
            BookFormatEntity,
            BookShelfEntity,
            SavedPositionEntity,
            AuthorEntity,
            SettingEntity,
            UserBookFavoriteEntity,
            BookDuplicateEntity,
            UserPreferenceEntity,
            BookClubEntity,
            BookClubMemberEntity,
            BookClubWorkEntity,
            BookClubReadingCopyEntity,
          ],
          migrations: [
            SchemaUpdate1755566512418,
            AddUserAndRoleTables1739836800000,
            SeedAdminRole1739836800001,
            AddSavedPositionsTable1755566512419,
            AddPercentageToSavedPosition1755566512420,
            AddAuthorTable1740614850000,
            AddSummaryToBook1755566512421,
            RemoveUserAndRoleTables1760000000000,
            AddUploadedByUserIdToBook1767225600000,
            AddCreatedByUserIdToBookShelf1772317868306,
            AddBookMetadataFields1772395519432,
            CreateSettingTable1772669702941,
            AddCreatedAtToBook1772681032915,
            AddSyncAndSoftDeleteFields1773287271444,
            AddUserBookFavoriteTable1773439568621,
            AddBookDuplicateTable1773801937488,
            AddBookFormatTable1774652732886,
            AddMetadataToBookFormat1777224804830,
            BackfillLegacyBookFormats1777228301570,
            AddFileSizeToBookFormat1790000000000,
            CreateUserPreferenceTable1790000000001,
            AddAudioTracksToBookFormat1790000000002,
            CreateBookClubCore1790000000003,
            CreateBookClubReadingCopy1790000000004,
            AddBookClubWorkMatching1790000000005,
          ],
          migrationsRun: true,
          migrationsTableName: 'migration_table',
          synchronize: false,
          logging: false,
          namingStrategy: new SnakeNamingStrategy(),
        };
      },
      inject: [ConfigService],
    }),
  ],
})
export class TypeOrmConfigModule {}
