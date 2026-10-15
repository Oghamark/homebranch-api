import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity()
export class BookClubDiscussionReplyEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'club_id', type: 'uuid' }) clubId: string;
  @Column({ name: 'thread_id', type: 'uuid' }) threadId: string;
  @Column({ name: 'author_user_id', type: 'uuid' }) authorUserId: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'boolean', default: false }) spoiler: boolean;
  @Column({ type: 'boolean', default: false }) hidden: boolean;
  @Column({ type: 'boolean', default: false }) deleted: boolean;
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' }) updatedAt: Date;
}
