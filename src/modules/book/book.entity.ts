import { Column, CreateDateColumn, Entity, ManyToMany, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { BookShelfEntity } from 'src/modules/book-shelf/book-shelf.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';

@Entity()
export class BookEntity {
  constructor(
    id?: string,
    title?: string,
    author?: string,
    fileName?: string,
    isFavorite: boolean = false,
    genres: string[] = [],
    publishedYear?: number,
    coverImageFileName?: string,
    summary?: string,
    uploadedByUserId?: string,
    series?: string,
    seriesPosition?: number,
    isbn?: string,
    pageCount?: number,
    publisher?: string,
    language?: string,
    averageRating?: number,
    ratingsCount?: number,
    metadataFetchedAt?: Date,
    createdAt?: Date,
    deletedAt?: Date,
    lastSyncedAt?: Date,
    syncedMetadata?: Record<string, unknown>,
    fileMtime?: number,
    fileContentHash?: string,
    metadataUpdatedAt?: Date,
    formats?: BookFormatEntity[],
    externalWorkId?: string,
    editionId?: string,
  ) {
    if (id !== undefined || title !== undefined || author !== undefined || fileName !== undefined) {
      if (!title || !author) {
        throw new Error('Title and author are required to create a book.');
      }

      this.id = id!;
      this.title = title;
      this.author = author;
      this.fileName = fileName!;
      this.isFavorite = isFavorite;
      this.genres = genres;
      this.publishedYear = publishedYear;
      this.coverImageFileName = coverImageFileName;
      this.summary = summary;
      this.uploadedByUserId = uploadedByUserId;
      this.series = series;
      this.seriesPosition = seriesPosition;
      this.isbn = isbn;
      this.pageCount = pageCount;
      this.publisher = publisher;
      this.language = language;
      this.averageRating = averageRating;
      this.ratingsCount = ratingsCount;
      this.metadataFetchedAt = metadataFetchedAt;
      this.createdAt = createdAt!;
      this.deletedAt = deletedAt;
      this.lastSyncedAt = lastSyncedAt;
      this.syncedMetadata = syncedMetadata;
      this.fileMtime = fileMtime;
      this.fileContentHash = fileContentHash;
      this.metadataUpdatedAt = metadataUpdatedAt;
      this.formats = formats;
      this.externalWorkId = externalWorkId;
      this.editionId = editionId;
    }
  }

  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  author: string;

  @Column({ name: 'is_favorite' })
  isFavorite: boolean;

  @Column({ type: 'simple-array', nullable: true, default: '' })
  genres: string[];

  @Column({ name: 'published_year', nullable: true })
  publishedYear?: number;

  @Column({ name: 'file_name' })
  fileName: string;

  @Column({ name: 'cover_image_file_name', nullable: true })
  coverImageFileName?: string;

  @Column({ type: 'text', nullable: true, default: null })
  summary?: string;

  @Column({ name: 'uploaded_by_user_id', nullable: true })
  uploadedByUserId?: string;

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

  @Column({ name: 'average_rating', nullable: true })
  averageRating?: number;

  @Column({ name: 'ratings_count', nullable: true })
  ratingsCount?: number;

  @Column({ name: 'metadata_fetched_at', nullable: true })
  metadataFetchedAt?: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'deleted_at', type: 'timestamp', nullable: true })
  deletedAt?: Date;

  @Column({ name: 'last_synced_at', type: 'timestamp', nullable: true })
  lastSyncedAt?: Date;

  @Column({ name: 'synced_metadata', type: 'jsonb', nullable: true })
  syncedMetadata?: Record<string, unknown>;

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

  @Column({ name: 'file_content_hash', nullable: true })
  fileContentHash?: string;

  @Column({ name: 'external_work_id', type: 'varchar', nullable: true })
  externalWorkId?: string;

  @Column({ name: 'edition_id', type: 'varchar', nullable: true })
  editionId?: string;

  @Column({ name: 'metadata_updated_at', type: 'timestamp', nullable: true })
  metadataUpdatedAt?: Date;

  @ManyToMany(() => BookShelfEntity, (bookShelf) => bookShelf.books)
  bookShelves?: BookShelfEntity[];

  @OneToMany(() => BookFormatEntity, (format) => format.book, {
    cascade: true,
    orphanedRowAction: 'delete',
  })
  formats?: BookFormatEntity[];
}
