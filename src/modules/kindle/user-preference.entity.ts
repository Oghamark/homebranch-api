import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity()
export class UserPreferenceEntity {
  @PrimaryColumn()
  userId: string;

  @Column({ type: 'varchar', nullable: true })
  kindleEmail: string | null;
}
