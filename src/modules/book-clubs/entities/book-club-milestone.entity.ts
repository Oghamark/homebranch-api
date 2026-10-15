import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum BookClubMilestoneKind {
  PART = 'part',
  CHAPTER = 'chapter',
  CHECKPOINT = 'checkpoint',
}

@Entity()
export class BookClubMilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'work_id', type: 'uuid' })
  workId: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar' })
  kind: BookClubMilestoneKind;

  @Column({ type: 'integer' })
  position: number;
}
