import { Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { PortableLocation } from '../book/publication/epub-location';

@Entity('koreader_device')
export class KoreaderDevice {
  @PrimaryColumn('uuid') id: string;
  @Column('uuid') userId: string;
  @Column('varchar', { unique: true }) username: string;
  @Column('varchar') verifier: string;
  @Column('varchar') name: string;
  @Column('timestamptz') createdAt: Date;
  @Column('timestamptz', { nullable: true }) lastSeenAt: Date | null;
  @Column('timestamptz') expiresAt: Date;
  @Column('timestamptz', { nullable: true }) revokedAt: Date | null;
}

@Entity('koreader_pairing')
export class KoreaderPairing {
  @PrimaryColumn('varchar') verifier: string;
  @Column('varchar', { unique: true }) codeVerifier: string;
  @Column('varchar') name: string;
  @Column('timestamptz') expiresAt: Date;
  @Column('uuid', { nullable: true }) userId: string | null;
  @Column('timestamptz', { nullable: true }) lastPollAt: Date | null;
  @Column('timestamptz', { nullable: true }) claimedAt: Date | null;
}

@Entity('koreader_revision')
export class KoreaderRevision {
  @PrimaryColumn('uuid') userId: string;
  @Column('bigint', { default: '0' }) revision: string;
  @Column('uuid', { nullable: true }) scanAfter: string | null;
}

@Entity('koreader_native_progress')
export class KoreaderNativeProgress {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('varchar') document: string;
  @Column('jsonb') payload: Record<string, unknown>;
  @Column('bigint') revision: string;
}

@Entity('koreader_book_progress')
export class KoreaderBookProgress {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('uuid') bookId: string;
  @Column('double precision', { nullable: true }) percentage: number | null;
  @Column('varchar') source: string;
  @Column('varchar') device: string;
  @Column('text', { nullable: true }) nativeProgress: string | null;
  @Column('jsonb', { nullable: true }) location: PortableLocation | null;
  @Column('bigint') revision: string;
  @Column('timestamptz') updatedAt: Date;
}

export interface QuoteAnchor {
  version: 1;
  href?: string;
  exact: string;
  prefix?: string;
  suffix?: string;
  native?: { pos0: string; pos1: string; domVersion?: number };
}

@Entity('koreader_annotation')
@Index(['userId', 'bookId', 'revision'])
export class KoreaderAnnotation {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('varchar') id: string;
  @Column('uuid') bookId: string;
  @Column('uuid', { nullable: true }) formatId: string | null;
  @Column('text') quote: string;
  @Column('text') note: string;
  @Column('varchar') color: string;
  @Column('jsonb') anchor: QuoteAnchor;
  @Column('boolean') deleted: boolean;
  @Column('bigint') revision: string;
  @Column('timestamptz') updatedAt: Date;
}

@Entity('koreader_mutation')
export class KoreaderMutation {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('varchar') mutationId: string;
  @Column('varchar') requestHash: string;
  @Column('jsonb') result: Record<string, unknown>;
}

@Entity('koreader_alias')
@Index(['userId', 'document'])
export class KoreaderAlias {
  @PrimaryColumn('uuid') userId: string;
  @PrimaryColumn('uuid') formatId: string;
  @PrimaryColumn('varchar') document: string;
  @Column('uuid') bookId: string;
  @Column('varchar', { nullable: true }) contentHash: string | null;
  @Column('varchar') fingerprint: string;
  @Column('varchar', { nullable: true }) spineHash: string | null;
  @Column('boolean', { default: false }) selected: boolean;
}

@Entity('koreader_rate')
export class KoreaderRate {
  @PrimaryColumn('varchar') bucket: string;
  @Column('integer') count: number;
  @Column('timestamptz') expiresAt: Date;
}

export const KOREADER_ENTITIES = [
  KoreaderDevice,
  KoreaderPairing,
  KoreaderRevision,
  KoreaderNativeProgress,
  KoreaderBookProgress,
  KoreaderAnnotation,
  KoreaderMutation,
  KoreaderAlias,
  KoreaderRate,
];
