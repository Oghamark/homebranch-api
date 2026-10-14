import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BookClubReadingCopySource } from 'src/modules/book-clubs/book-club.types';

@Entity()
@Unique('UQ_book_club_reading_copy_member_work', ['memberId', 'workId'])
export class BookClubReadingCopyEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ name: 'book_id', type: 'uuid', nullable: true })
  bookId?: string | null;

  @Column({ type: 'varchar', default: BookClubReadingCopySource.NONE })
  source: BookClubReadingCopySource;
}
