import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('social_account')
export class SocialAccountEntity {
  @PrimaryColumn('varchar') userId: string;
  @Column('varchar') name: string;
  @Column({ default: true }) allowFriendRequests: boolean;
  @Column({ type: 'varchar', default: 'anyone' }) clubInvites: string;
}

@Entity('social_friendship')
export class SocialFriendshipEntity {
  @PrimaryColumn('varchar') lowId: string;
  @PrimaryColumn('varchar') highId: string;
  @Column('uuid') id: string;
  @Column('varchar') requesterId: string;
  @Column('varchar') status: string;
  @Column('timestamptz') createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
}

@Entity('social_block')
export class SocialBlockEntity {
  @PrimaryColumn('varchar') userId: string;
  @PrimaryColumn('varchar') blockedId: string;
}

@Entity('social_club_invitation')
export class SocialClubInvitationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') clubId: string;
  @Column('varchar') inviterId: string;
  @Column('varchar') inviteeId: string;
  @Column('varchar') status: string;
  @Column('timestamptz') createdAt: Date;
  @Column('timestamptz') expiresAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) resolvedAt: Date | null;
}

@Entity('social_club_mute')
export class SocialClubMuteEntity {
  @PrimaryColumn('uuid') clubId: string;
  @PrimaryColumn('varchar') userId: string;
  @Column({ default: false }) muted: boolean;
}

@Entity('social_notification')
export class SocialNotificationEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('varchar') recipientId: string;
  @Column('varchar') actorId: string;
  @Column('varchar') kind: string;
  @Column('varchar') eventKey: string;
  @Column({ type: 'uuid', nullable: true }) clubId: string | null;
  @Column({ type: 'uuid', nullable: true }) threadId: string | null;
  @Column({ type: 'uuid', nullable: true }) replyId: string | null;
  @Column({ type: 'uuid', nullable: true }) requestId: string | null;
  @Column('timestamptz') createdAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) readAt: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) dismissedAt: Date | null;
}

@Entity('social_rate')
export class SocialRateEntity {
  @PrimaryColumn('varchar') userId: string;
  @PrimaryColumn('varchar') scope: string;
  @Column('timestamptz') windowStart: Date;
  @Column('integer') count: number;
}

export const SOCIAL_ENTITIES = [
  SocialAccountEntity,
  SocialFriendshipEntity,
  SocialBlockEntity,
  SocialClubInvitationEntity,
  SocialClubMuteEntity,
  SocialNotificationEntity,
  SocialRateEntity,
];
