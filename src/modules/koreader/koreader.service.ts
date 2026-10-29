import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { KoreaderAuthService, SyncActor, verifier } from './koreader-auth.service';
import { KoreaderDocumentService } from './koreader-document.service';
import { nextSyncRevision } from './koreader-ordering';
import { annotationInput, documentId, fraction, identifier, object, text } from './koreader-validation';
import { QuoteAnchor } from './koreader.entity';
import { parsePortableLocation, PortableLocation } from '../book/publication/epub-location';

interface AnnotationRow {
  id: string;
  book_id: string;
  quote: string;
  note: string;
  color: string;
  anchor: QuoteAnchor;
  deleted: boolean;
  revision: string;
  updated_at: Date;
}

export interface NativePayload {
  document: string;
  progress: string;
  percentage: number;
  device: string;
  device_id?: string;
  timestamp: number;
}

type NativeAcknowledgement = Pick<NativePayload, 'document' | 'timestamp'>;

interface SharedProgress {
  percentage: number;
  source: 'web' | 'koreader';
  accuracy: 'exact' | 'approximate';
  device: string;
  revision: string;
  updatedAt: string;
  nativeProgress?: string;
  location?: PortableLocation;
}

function publicAnnotation(row: AnnotationRow) {
  return {
    id: row.id,
    bookId: row.book_id,
    quote: row.quote,
    note: row.note,
    color: row.color,
    anchor: row.anchor,
    deleted: row.deleted,
    revision: row.revision,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

@Injectable()
export class KoreaderService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: KoreaderAuthService,
    private readonly documents: KoreaderDocumentService,
  ) {}

  async authenticated(actor: SyncActor) {
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      return { authorized: 'OK' };
    });
  }

  private async retry<T>(
    manager: EntityManager,
    actor: SyncActor,
    mutationId: string | undefined,
    hash: string,
  ): Promise<T | null> {
    if (!mutationId) return null;
    const [prior] = await manager.query<{ request_hash: string; result: T }[]>(
      `SELECT request_hash,result FROM koreader_mutation WHERE user_id=$1 AND mutation_id=$2`,
      [actor.id, mutationId],
    );
    if (prior && prior.request_hash !== hash)
      throw new ConflictException('Mutation ID was already used for another operation');
    return prior?.result ?? null;
  }

  private async remember(
    manager: EntityManager,
    actor: SyncActor,
    id: string | undefined,
    hash: string,
    result: unknown,
  ) {
    if (!id) return;
    await manager.query(`INSERT INTO koreader_mutation(user_id,mutation_id,request_hash,result) VALUES($1,$2,$3,$4)`, [
      actor.id,
      id,
      hash,
      JSON.stringify(result),
    ]);
  }

  async putNativeProgress(actor: SyncActor, value: unknown) {
    const body = object(value);
    const document = documentId(body.document);
    const progress = text(body.progress, 8192);
    const percentage = fraction(body.percentage);
    const device = text(body.device, 128);
    const deviceId = body.device_id === undefined ? undefined : text(body.device_id, 128);
    const mutationId = body.mutationId === undefined ? undefined : identifier(body.mutationId);
    const location = body.location === undefined ? undefined : parsePortableLocation(body.location);
    const hashFields: unknown[] = ['native-progress', document, progress, percentage, device, deviceId];
    if (location !== undefined) hashFields.push(location);
    const requestHash = verifier(JSON.stringify(hashFields));
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, true);
      const prior = await this.retry<NativeAcknowledgement>(manager, actor, mutationId, requestHash);
      if (prior) return prior;
      const linked = await this.documents.linked(manager, actor, document);
      if (location) {
        if (!linked || linked.formatId !== location.formatId) {
          throw new BadRequestException('Portable location requires the verified document format');
        }
        await this.documents.validateLocation(manager, actor, linked.bookId, location);
      }
      const revision = await nextSyncRevision(manager, actor.id);
      const timestamp = Math.floor(Date.now() / 1000);
      const payload = {
        document,
        progress,
        percentage,
        device,
        ...(deviceId === undefined ? {} : { device_id: deviceId }),
        timestamp,
      };
      await manager.query(
        `INSERT INTO koreader_native_progress(user_id,document,payload,revision) VALUES($1,$2,$3,$4)
         ON CONFLICT(user_id,document) DO UPDATE SET payload=EXCLUDED.payload,revision=EXCLUDED.revision`,
        [actor.id, document, JSON.stringify(payload), revision],
      );
      if (linked) {
        await manager.query(
          `INSERT INTO koreader_book_progress(user_id,book_id,percentage,source,device,native_progress,revision,location)
           VALUES($1,$2,$3,'koreader',$4,$5,$6,$7) ON CONFLICT(user_id,book_id) DO UPDATE
           SET percentage=EXCLUDED.percentage,source='koreader',device=EXCLUDED.device,
           native_progress=EXCLUDED.native_progress,location=EXCLUDED.location,revision=EXCLUDED.revision,updated_at=clock_timestamp()`,
          [actor.id, linked.bookId, percentage, device, progress, revision, location ? JSON.stringify(location) : null],
        );
      }
      const result = { document, timestamp };
      await this.remember(manager, actor, mutationId, requestHash, result);
      return result;
    });
  }

  async getNativeProgress(actor: SyncActor, value: string) {
    const document = documentId(value);
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      // Native records never contain a synthetic web locator or a rewritten timestamp.
      const [row] = await manager.query<{ payload: NativePayload }[]>(
        `SELECT payload FROM koreader_native_progress WHERE user_id=$1 AND document=$2`,
        [actor.id, document],
      );
      return row?.payload ?? {};
    });
  }

  async progress(actor: SyncActor, bookId: string): Promise<SharedProgress | null> {
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      await this.documents.requireBook(manager, actor, bookId);
      const [row] = await manager.query<
        {
          percentage: number | null;
          source: 'web' | 'koreader';
          device: string;
          native_progress: string | null;
          revision: string;
          updated_at: Date;
          location: PortableLocation | null;
        }[]
      >(
        `SELECT percentage,source,device,native_progress,revision,updated_at,location FROM koreader_book_progress
         WHERE user_id=$1 AND book_id=$2`,
        [actor.id, bookId],
      );
      if (row) {
        if (row.percentage === null) return null;
        const hasPortableLocation = row.location !== null && row.location !== undefined;
        const location = hasPortableLocation
          ? await this.documents.compatibleLocation(manager, actor, bookId, row.location)
          : null;
        return {
          percentage: row.percentage,
          source: row.source,
          accuracy: row.source === 'web' && !actor.deviceId ? 'exact' : 'approximate',
          ...(row.source === 'koreader' && row.native_progress && (!hasPortableLocation || location)
            ? { nativeProgress: row.native_progress }
            : {}),
          device: row.device,
          revision: row.revision,
          updatedAt: new Date(row.updated_at).toISOString(),
          ...(location ? { location } : {}),
        };
      }
      const [legacy] = await manager.query<{ percentage: number | null; device_name: string; updated_at: Date }[]>(
        `SELECT percentage,device_name,updated_at FROM saved_position_entity WHERE user_id=$1 AND book_id=$2`,
        [actor.id, bookId],
      );
      if (!legacy || legacy.percentage === null) return null;
      return {
        percentage: legacy.percentage,
        source: 'web',
        accuracy: actor.deviceId ? 'approximate' : 'exact',
        device: legacy.device_name,
        revision: '0',
        updatedAt: new Date(legacy.updated_at).toISOString(),
      };
    });
  }

  async annotations(actor: SyncActor, bookId: string, after: unknown = '0') {
    if (typeof after !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(after)) {
      throw new BadRequestException('Invalid annotation cursor');
    }
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      await this.documents.requireBook(manager, actor, bookId);
      const [{ revision }] = await manager.query(`SELECT revision FROM koreader_revision WHERE user_id=$1`, [actor.id]);
      if (BigInt(after) > BigInt(revision)) throw new BadRequestException('Cursor is ahead of this account');
      const rows = await manager.query<AnnotationRow[]>(
        `SELECT * FROM koreader_annotation WHERE user_id=$1 AND book_id=$2 AND revision>$3
         ORDER BY revision,id LIMIT 101`,
        [actor.id, bookId, after],
      );
      const page = rows.slice(0, 100);
      const hasMore = rows.length > 100;
      return {
        items: page.map(publicAnnotation),
        cursor: hasMore ? page[page.length - 1].revision : revision,
        hasMore,
      };
    });
  }

  async putAnnotation(actor: SyncActor, bookId: string, annotationId: string, value: unknown) {
    const id = identifier(annotationId);
    const input = annotationInput(value);
    const hash = verifier(JSON.stringify(['annotation', bookId, id, input]));
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, true);
      const format = await this.documents.requireBook(manager, actor, bookId);
      const prior = await this.retry<ReturnType<typeof publicAnnotation>>(manager, actor, input.mutationId, hash);
      if (prior) return prior;
      const [existing] = await manager.query(`SELECT book_id FROM koreader_annotation WHERE user_id=$1 AND id=$2`, [
        actor.id,
        id,
      ]);
      if (existing && existing.book_id !== bookId) throw new NotFoundException('Annotation unavailable');
      const revision = await nextSyncRevision(manager, actor.id);
      const [row] = await manager.query<AnnotationRow[]>(
        `INSERT INTO koreader_annotation(user_id,id,book_id,quote,note,color,anchor,deleted,revision,updated_at,format_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10) ON CONFLICT(user_id,id) DO UPDATE SET
         quote=EXCLUDED.quote,note=EXCLUDED.note,color=EXCLUDED.color,anchor=EXCLUDED.anchor,
         deleted=EXCLUDED.deleted,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,
         format_id=EXCLUDED.format_id RETURNING *`,
        [
          actor.id,
          id,
          bookId,
          input.quote,
          input.note,
          input.color,
          JSON.stringify(input.anchor),
          input.deleted,
          revision,
          format.format_id,
        ],
      );
      const result = publicAnnotation(row);
      await this.remember(manager, actor, input.mutationId, hash, result);
      return result;
    });
  }
}
