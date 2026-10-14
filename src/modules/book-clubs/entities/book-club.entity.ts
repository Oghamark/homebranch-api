import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';

@Entity()
export class BookClubEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Column({ type: 'varchar', default: BookClubVisibility.PRIVATE })
  visibility: BookClubVisibility;

  @Column({ type: 'varchar', default: BookClubStatus.ACTIVE })
  status: BookClubStatus;

  @Column({ name: 'owner_user_id', type: 'varchar' })
  ownerUserId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt: Date;
}
