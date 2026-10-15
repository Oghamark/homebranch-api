import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity()
@Unique('UQ_book_club_milestone_mapping_member_milestone', ['memberId', 'milestoneId'])
export class BookClubMilestoneMappingEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'member_id', type: 'uuid' })
  memberId: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ name: 'milestone_id', type: 'uuid' })
  milestoneId: string;

  @Column({ name: 'member_label', type: 'varchar', length: 120 })
  memberLabel: string;

  @Column({ name: 'member_position', type: 'integer', nullable: true })
  memberPosition?: number | null;
}
