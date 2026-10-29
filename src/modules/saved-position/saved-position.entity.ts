import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { PortableLocation } from '../book/publication/epub-location';

@Entity()
export class SavedPositionEntity {
  @PrimaryColumn('uuid', { name: 'book_id' })
  bookId: string;

  @PrimaryColumn('uuid', { name: 'user_id' })
  userId: string;

  @Column()
  position: string;

  @Column({ name: 'device_name' })
  deviceName: string;

  @Column({ type: 'float', nullable: true, default: null })
  percentage: number | null;

  @Column({ type: 'jsonb', nullable: true })
  location?: PortableLocation | null;

  @Column({ type: 'bigint', nullable: true })
  revision?: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => BookEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'book_id' })
  book?: BookEntity;
}
