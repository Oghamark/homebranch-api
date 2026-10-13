import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { AudioTrack } from 'src/modules/book/format/audio-track';
import { BookEntity } from 'src/modules/book/book.entity';
import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity()
@Unique('UQ_book_format_entity_book_id_format', ['bookId', 'format'])
@Unique('UQ_book_format_entity_file_name', ['fileName'])
export class BookFormatEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'book_id' })
  bookId: string;

  @ManyToOne(() => BookEntity, (book) => book.formats, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book?: BookEntity;

  @Column({ type: 'varchar' })
  format: BookFormatType;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({
    name: 'file_mtime',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: number | undefined) => (v != null ? Math.round(v) : v),
      from: (v: string | null) => (v ? Number(v) : undefined),
    },
  })
  fileMtime?: number;

  @Column({
    name: 'file_size',
    type: 'bigint',
    nullable: true,
    transformer: {
      to: (v: number | undefined) => v,
      from: (v: string | null) => (v ? Number(v) : undefined),
    },
  })
  fileSize?: number;

  @Column({ name: 'file_content_hash', nullable: true })
  fileContentHash?: string;

  @Column({ name: 'audio_tracks', type: 'jsonb', nullable: true })
  audioTracks?: AudioTrack[];

  @Column({ nullable: true })
  title?: string;

  @Column({ nullable: true })
  author?: string;

  @Column({ type: 'simple-array', nullable: true, default: '' })
  genres?: string[];

  @Column({ name: 'published_year', nullable: true })
  publishedYear?: number;

  @Column({ name: 'cover_image_file_name', nullable: true })
  coverImageFileName?: string;

  @Column({ type: 'text', nullable: true, default: null })
  summary?: string;

  @Column({ nullable: true })
  series?: string;

  @Column({ name: 'series_position', nullable: true })
  seriesPosition?: number;

  @Column({ nullable: true })
  isbn?: string;

  @Column({ name: 'page_count', nullable: true })
  pageCount?: number;

  @Column({ nullable: true })
  publisher?: string;

  @Column({ nullable: true })
  language?: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
