import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

export enum BookClubProgressStatus {
  NOT_STARTED = 'not_started',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
}

@Entity()
@Unique('UQ_book_club_milestone_progress_member_milestone', ['memberId', 'milestoneId'])
export class BookClubMilestoneProgressEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ name: 'milestone_id', type: 'uuid' })
  milestoneId: string;

  @Column({ type: 'varchar' })
  status: BookClubProgressStatus;

  @Column({ type: 'integer', nullable: true })
  percentage?: number | null;
}
