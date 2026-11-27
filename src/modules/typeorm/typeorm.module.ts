import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { UserBookFavoriteEntity } from 'src/modules/book/user-book-favorite.entity';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { AuthorEntity } from 'src/modules/author/author.entity';
import { SettingEntity } from 'src/modules/settings/setting.entity';
import { BookDuplicateEntity } from 'src/modules/book/deduplication/book-duplicate.entity';
import { UserPreferenceEntity } from 'src/modules/kindle/user-preference.entity';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubMilestoneEntity } from 'src/modules/book-clubs/entities/book-club-milestone.entity';
import { BookClubMilestoneMappingEntity } from 'src/modules/book-clubs/entities/book-club-milestone-mapping.entity';
import { BookClubMilestoneProgressEntity } from 'src/modules/book-clubs/entities/book-club-milestone-progress.entity';
import { BookClubDiscussionThreadEntity } from 'src/modules/book-clubs/entities/book-club-discussion-thread.entity';
import { BookClubDiscussionReplyEntity } from 'src/modules/book-clubs/entities/book-club-discussion-reply.entity';
import { BookClubModerationAuditEntity } from 'src/modules/book-clubs/entities/book-club-moderation-audit.entity';
import { SOCIAL_ENTITIES } from 'src/modules/social/social.entity';
import { KOREADER_ENTITIES } from '../koreader/koreader.entity';
import { AuditLogEntity } from 'src/modules/audit/audit-log.entity';

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
            AuditLogEntity,
            ...KOREADER_ENTITIES,
            ...SOCIAL_ENTITIES,
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
            BookClubMilestoneEntity,
            BookClubMilestoneMappingEntity,
            BookClubMilestoneProgressEntity,
            BookClubDiscussionThreadEntity,
            BookClubDiscussionReplyEntity,
            BookClubModerationAuditEntity,
          ],
          migrations: [join(__dirname, '..', '..', 'migrations', '*{.ts,.js}')],
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
