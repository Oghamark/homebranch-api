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

  @Column({ type: 'varchar', nullable: true })
  isbn?: string | null;

  @Column({ name: 'external_work_id', type: 'varchar', nullable: true })
  externalWorkId?: string | null;

  @Column({ name: 'edition_id', type: 'varchar', nullable: true })
  editionId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  series?: string | null;

  @Column({ name: 'series_position', type: 'integer', nullable: true })
  seriesPosition?: number | null;
}
