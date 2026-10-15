import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export class BookClubModerationAuditEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'club_id', type: 'uuid' }) clubId: string;
  @Column({ name: 'actor_user_id', type: 'uuid' }) actorUserId: string;
  @Column({ type: 'varchar', length: 32 }) action: string;
  @Column({ name: 'target_type', type: 'varchar', length: 16 }) targetType: 'thread' | 'reply';
  @Column({ name: 'target_id', type: 'uuid' }) targetId: string;
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' }) createdAt: Date;
}
