import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

@Module({
  imports: [TypeOrmModule.forFeature([BookClubEntity, BookClubMemberEntity, BookClubWorkEntity]), AuthModule],
  providers: [BookClubsService],
  controllers: [BookClubsController],
  exports: [BookClubsService],
})
export class BookClubsModule {}
