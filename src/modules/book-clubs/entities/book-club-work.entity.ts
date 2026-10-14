import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Logical work selected by a club; intentionally has no book-file, format, hash, or edition reference. */
@Entity()
export class BookClubWorkEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'club_id', type: 'uuid', unique: true })
  clubId: string;

  @Column({ type: 'varchar', length: 300 })
  title: string;

  @Column({ type: 'varchar', length: 300 })
  author: string;
}
