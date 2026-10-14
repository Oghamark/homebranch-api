import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { BookClubRole } from 'src/modules/book-clubs/book-club.types';

@Entity()
@Unique('UQ_book_club_member_club_user', ['clubId', 'userId'])
export class BookClubMemberEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'club_id', type: 'uuid' })
  clubId: string;

  @Column({ name: 'user_id', type: 'varchar' })
  userId: string;

  /** Reserved for a future personal-copy association; no API currently reads or writes this field. */
  @Column({ name: 'personal_book_id', type: 'uuid', nullable: true })
  personalBookId?: string | null;

  @Column({ type: 'varchar', default: BookClubRole.MEMBER })
  role: BookClubRole;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;
}
