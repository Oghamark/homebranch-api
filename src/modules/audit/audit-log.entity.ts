import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
@Index('IDX_audit_log_created_at', ['createdAt', 'id'])
@Index('IDX_audit_log_actor_id', ['actorId'])
export class AuditLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ name: 'actor_label', type: 'varchar', length: 320, nullable: true })
  actorLabel: string | null;

  @Column({ type: 'varchar', length: 10 })
  method: string;

  @Column({ type: 'varchar', length: 500 })
  route: string;

  @Column({ name: 'resource_ids', type: 'jsonb', default: '{}' })
  resourceIds: Record<string, string>;

  @Column({ name: 'status_code', type: 'integer' })
  statusCode: number;

  @Column({ type: 'varchar', length: 10 })
  outcome: 'success' | 'failure';
}
