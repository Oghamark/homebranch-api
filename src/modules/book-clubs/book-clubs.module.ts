import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookCoreModule } from 'src/modules/book/book-core.module';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([BookClubEntity, BookClubMemberEntity, BookClubWorkEntity, BookClubReadingCopyEntity]),
    AuthModule,
    BookCoreModule,
  ],
  providers: [BookClubsService],
  controllers: [BookClubsController],
  exports: [BookClubsService],
})
export class BookClubsModule {}
