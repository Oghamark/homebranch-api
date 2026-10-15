import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookCoreModule } from 'src/modules/book/book-core.module';
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
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubDiscussionService } from 'src/modules/book-clubs/book-club-discussion.service';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
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
    ]),
    AuthModule,
    BookCoreModule,
  ],
  providers: [BookClubsService, BookClubDiscussionService],
  controllers: [BookClubsController],
  exports: [BookClubsService],
})
export class BookClubsModule {}
