import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { tenantScope } from 'src/common/utils/cloud';
import { BookService } from '../book/catalog/book.service';
import { ContentHashService } from '../book/format/content-hash.service';
import { IStorageService, STORAGE_SERVICE_TOKEN } from '../storage/storage.interface';
import { KoreaderAuthService, SyncActor, verifier } from './koreader-auth.service';
import { partialMd5FromStorage } from './partial-md5';
import { metadataIndependentIdentity } from './epub-identity';
import { documentId, object, text, uuid } from './koreader-validation';
import { EpubLocationService } from '../book/publication/epub-location.service';
import { PortableLocation } from '../book/publication/epub-location';

interface AliasRow {
  user_id: string;
  format_id: string;
  document: string;
  book_id: string;
  content_hash: string | null;
  fingerprint: string;
  spine_hash: string | null;
  selected: boolean;
}

interface FormatRow {
  id: string;
  book_id: string;
  file_name: string;
  file_content_hash: string | null;
}

@Injectable()
export class KoreaderDocumentService {
  constructor(
    private readonly db: DataSource,
    private readonly auth: KoreaderAuthService,
    private readonly books: BookService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
    private readonly hashes: ContentHashService,
    private readonly locations: EpubLocationService,
  ) {}

  validateLocation(manager: EntityManager, actor: SyncActor, bookId: string, value: PortableLocation) {
    return this.locations.validate(manager, actor.id, bookId, value);
  }

  compatibleLocation(manager: EntityManager, actor: SyncActor, bookId: string, value: unknown) {
    return this.locations.compatible(manager, actor.id, bookId, value);
  }

  async locationMap(actor: SyncActor, bookId: string, formatId: string) {
    return this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      const [format] = await manager.query<(FormatRow & { document: string })[]>(
        `SELECT f.*,a.document FROM koreader_alias a JOIN book_format_entity f ON f.id=a.format_id
         JOIN book_entity b ON b.id=f.book_id
         WHERE a.user_id=$1 AND f.book_id=$2 AND f.id=$3 AND f.format='EPUB'
         AND a.content_hash IS NOT NULL AND b.deleted_at IS NULL
         AND ($4::varchar IS NULL OR b.uploaded_by_user_id=$4) LIMIT 1`,
        [actor.id, bookId, formatId, tenantScope(actor) ?? null],
      );
      if (!format) throw new NotFoundException('Resolve this EPUB format before requesting its location map');
      await this.indexFormat(manager, actor, format, format.document);
      const [verified] = await manager.query<{ format_id: string }[]>(
        `SELECT format_id FROM koreader_alias WHERE user_id=$1 AND format_id=$2 AND content_hash IS NOT NULL LIMIT 1`,
        [actor.id, formatId],
      );
      if (!verified) throw new NotFoundException('EPUB identity changed; resolve the document again');
      return this.locations.map(manager, actor.id, bookId, formatId);
    });
  }

  async requireBook(manager: EntityManager, actor: SyncActor, bookId: string) {
    await this.books.assertAccess(bookId, tenantScope(actor));
    const [book] = await manager.query<{ id: string; title: string; format_id: string }[]>(
      `SELECT b.id,b.title,f.id AS format_id FROM book_entity b
       JOIN book_format_entity f ON f.book_id=b.id AND f.format='EPUB'
       WHERE b.id=$1 AND b.deleted_at IS NULL AND ($2::varchar IS NULL OR b.uploaded_by_user_id=$2)
       FOR SHARE OF b,f`,
      [bookId, tenantScope(actor) ?? null],
    );
    if (!book) throw new NotFoundException('Accessible EPUB not found');
    return book;
  }

  private async indexFormat(
    manager: EntityManager,
    actor: SyncActor,
    format: FormatRow,
    target: string,
    spineHint?: string,
    forceSpine = false,
  ) {
    const key = `books/${format.file_name}`;
    let stats;
    try {
      stats = await this.storage.getFileStats(key);
    } catch (error) {
      if (error instanceof NotFoundException) {
        await manager.query(`DELETE FROM koreader_alias WHERE user_id=$1 AND format_id=$2`, [actor.id, format.id]);
        return 0;
      }
      throw new ServiceUnavailableException('Book storage unavailable; retry later');
    }
    const fingerprint = verifier(
      `${key}:${stats.size}:${stats.mtimeMs}:${stats.etag ?? ''}:${format.file_content_hash ?? ''}`,
    );
    const aliases = await manager.query<AliasRow[]>(`SELECT * FROM koreader_alias WHERE user_id=$1 AND format_id=$2`, [
      actor.id,
      format.id,
    ]);
    const current = aliases.find((alias) => alias.fingerprint === fingerprint && alias.document === target);
    const alreadyIndexed = aliases.some((alias) => alias.fingerprint === fingerprint);
    const needsSpine =
      spineHint &&
      !aliases.some((alias) => alias.fingerprint === fingerprint && alias.spine_hash) &&
      (forceSpine || !format.file_content_hash || format.file_content_hash === spineHint);
    if (alreadyIndexed && !needsSpine && (!current || current.content_hash || stats.size > 32 * 1024 * 1024)) return 0;
    let document: string;
    let contentHash: string | null = null;
    let spineHash: string | null = null;
    let verifiedBytes = 0;
    try {
      document = await partialMd5FromStorage(this.storage, key, stats.size);
      const needsIdentity =
        document === target ||
        aliases.some((alias) => alias.content_hash) ||
        (spineHint && (forceSpine || !format.file_content_hash || format.file_content_hash === spineHint));
      if (needsIdentity && stats.size <= 32 * 1024 * 1024) {
        const { stream } = await this.storage.getFileStream(key);
        const chunks: Buffer[] = [];
        let length = 0;
        try {
          for await (const chunk of stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            length += bytes.length;
            if (length > 32 * 1024 * 1024) throw new Error('Book changed while indexing');
            chunks.push(bytes);
          }
          if (length !== stats.size) throw new Error('Book changed while indexing');
          const buffer = Buffer.concat(chunks);
          contentHash = metadataIndependentIdentity(buffer);
          spineHash = contentHash ? this.hashes.computeHashFromBuffer(buffer, 'book.epub') : null;
          verifiedBytes = buffer.length;
        } finally {
          stream.destroy();
        }
      }
      const after = await this.storage.getFileStats(key);
      if (after.size !== stats.size || after.mtimeMs !== stats.mtimeMs || after.etag !== stats.etag) {
        throw new Error('Book changed while indexing');
      }
    } catch {
      throw new ServiceUnavailableException('Could not verify EPUB identity; retry later');
    }
    // A replacement, including an unparseable/large rewritten file, invalidates all old aliases.
    await manager.query(
      `DELETE FROM koreader_alias WHERE user_id=$1 AND format_id=$2
       AND ($3::varchar IS NULL OR content_hash IS DISTINCT FROM $3)`,
      [actor.id, format.id, contentHash],
    );
    await manager.query(`UPDATE koreader_alias SET fingerprint=$3,spine_hash=$4 WHERE user_id=$1 AND format_id=$2`, [
      actor.id,
      format.id,
      fingerprint,
      spineHash,
    ]);
    await manager.query(
      `INSERT INTO koreader_alias(user_id,format_id,document,book_id,content_hash,fingerprint,spine_hash)
       VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,format_id,document) DO UPDATE
       SET content_hash=EXCLUDED.content_hash,fingerprint=EXCLUDED.fingerprint,book_id=EXCLUDED.book_id,spine_hash=EXCLUDED.spine_hash`,
      [actor.id, format.id, document, format.book_id, contentHash, fingerprint, spineHash],
    );
    return verifiedBytes;
  }

  async linked(manager: EntityManager, actor: SyncActor, document: string) {
    const matches = await manager.query<FormatRow[]>(
      `SELECT DISTINCT f.* FROM koreader_alias a JOIN book_format_entity f ON f.id=a.format_id
       JOIN book_entity b ON b.id=f.book_id WHERE a.user_id=$1 AND a.document=$2 AND f.format='EPUB'
       AND b.deleted_at IS NULL AND ($3::varchar IS NULL OR b.uploaded_by_user_id=$3)
       AND (a.selected OR NOT EXISTS(SELECT 1 FROM koreader_alias s WHERE s.user_id=$1 AND s.document=$2 AND s.selected))
       LIMIT 33`,
      [actor.id, document, tenantScope(actor) ?? null],
    );
    if (matches.length > 32) throw new ConflictException('Ambiguous document identity');
    for (const match of matches) await this.indexFormat(manager, actor, match, document);
    const rows = await manager.query<{ bookId: string; formatId: string; title: string; selected: boolean }[]>(
      `SELECT a.book_id AS "bookId",a.format_id AS "formatId",b.title,a.selected FROM koreader_alias a
       JOIN book_format_entity f ON f.id=a.format_id AND f.format='EPUB'
       JOIN book_entity b ON b.id=a.book_id WHERE a.user_id=$1 AND a.document=$2
       AND b.deleted_at IS NULL AND ($3::varchar IS NULL OR b.uploaded_by_user_id=$3)
       AND (a.selected OR NOT EXISTS(SELECT 1 FROM koreader_alias s WHERE s.user_id=$1 AND s.document=$2 AND s.selected))
       LIMIT 2`,
      [actor.id, document, tenantScope(actor) ?? null],
    );
    const selected = rows.filter((row) => row.selected);
    const candidates = selected.length ? selected : rows;
    if (candidates.length > 1) throw new ConflictException('Ambiguous document identity');
    if (!candidates.length) return null;
    const { bookId, formatId, title } = candidates[0];
    await this.requireBook(manager, actor, bookId);
    return { bookId, formatId, title };
  }

  private async selectVerifiedContent(
    manager: EntityManager,
    actor: SyncActor,
    document: string,
    contentHash: string,
    formatId?: string,
  ) {
    const candidates = await manager.query<FormatRow[]>(
      `SELECT DISTINCT f.* FROM koreader_alias a JOIN book_format_entity f ON f.id=a.format_id
       JOIN book_entity b ON b.id=f.book_id WHERE a.user_id=$1 AND a.spine_hash=$2 AND f.format='EPUB'
       AND ($3::uuid IS NULL OR f.id=$3) AND b.deleted_at IS NULL
       AND ($4::varchar IS NULL OR b.uploaded_by_user_id=$4) LIMIT 33`,
      [actor.id, contentHash, formatId ?? null, tenantScope(actor) ?? null],
    );
    if (candidates.length > 32) throw new ConflictException('Ambiguous content identity');
    for (const format of candidates) await this.indexFormat(manager, actor, format, document, contentHash);
    const matches = await manager.query<{ format_id: string }[]>(
      `SELECT DISTINCT a.format_id FROM koreader_alias a JOIN book_format_entity f ON f.id=a.format_id
       JOIN book_entity b ON b.id=f.book_id WHERE a.user_id=$1 AND a.spine_hash=$2 AND f.format='EPUB'
       AND ($3::uuid IS NULL OR f.id=$3) AND b.deleted_at IS NULL
       AND ($4::varchar IS NULL OR b.uploaded_by_user_id=$4) LIMIT 2`,
      [actor.id, contentHash, formatId ?? null, tenantScope(actor) ?? null],
    );
    if (matches.length > 1) throw new ConflictException('Ambiguous content identity; choose a verified formatId');
    if (!matches.length) return null;
    await manager.query(`UPDATE koreader_alias SET selected=false WHERE user_id=$1 AND document=$2`, [
      actor.id,
      document,
    ]);
    await manager.query(
      `INSERT INTO koreader_alias(user_id,format_id,document,book_id,content_hash,fingerprint,spine_hash,selected)
       SELECT user_id,format_id,$3,book_id,content_hash,fingerprint,spine_hash,true FROM koreader_alias
       WHERE user_id=$1 AND format_id=$2 AND spine_hash=$4 LIMIT 1
       ON CONFLICT(user_id,format_id,document) DO UPDATE
       SET selected=true,content_hash=EXCLUDED.content_hash,fingerprint=EXCLUDED.fingerprint,spine_hash=EXCLUDED.spine_hash`,
      [actor.id, matches[0].format_id, document, contentHash],
    );
    return this.linked(manager, actor, document);
  }

  async resolve(actor: SyncActor, value: unknown) {
    const input = object(value);
    const document = documentId(input.document);
    const contentHash = input.contentHash === undefined ? undefined : text(input.contentHash, 64).toLowerCase();
    if (contentHash !== undefined && !/^[a-f0-9]{64}$/.test(contentHash))
      throw new BadRequestException('Invalid content hash');
    const formatId = input.formatId === undefined ? undefined : uuid(input.formatId);
    if (formatId && !contentHash) throw new BadRequestException('Manual selection requires verified contentHash');
    const result = await this.db.transaction(async (manager) => {
      await this.auth.lockActor(manager, actor, false);
      const [state] = await manager.query(`SELECT scan_after FROM koreader_revision WHERE user_id=$1`, [actor.id]);
      // Small, resumable keyset scans. Never load a whole library or search another tenant.
      const formats = await manager.query<FormatRow[]>(
        `SELECT f.* FROM book_format_entity f JOIN book_entity b ON b.id=f.book_id
         WHERE f.format='EPUB' AND b.deleted_at IS NULL AND ($1::varchar IS NULL OR b.uploaded_by_user_id=$1)
         AND ($2::uuid IS NULL OR f.id>$2) AND ($3::uuid IS NULL OR f.id=$3) ORDER BY f.id LIMIT 33`,
        [tenantScope(actor) ?? null, formatId ? null : state.scan_after, formatId ?? null],
      );
      let verifiedBytes = 0;
      const processed: FormatRow[] = [];
      for (const format of formats.slice(0, 32)) {
        if (verifiedBytes >= 64 * 1024 * 1024) break;
        verifiedBytes += await this.indexFormat(manager, actor, format, document, contentHash, Boolean(formatId));
        processed.push(format);
      }
      const hasMore = formats.length > processed.length;
      await manager.query(`UPDATE koreader_revision SET scan_after=$2 WHERE user_id=$1`, [
        actor.id,
        hasMore ? processed[processed.length - 1].id : null,
      ]);
      if (hasMore) return { pending: true as const };
      const match = contentHash
        ? await this.selectVerifiedContent(manager, actor, document, contentHash, formatId)
        : await this.linked(manager, actor, document);
      if (match) {
        // Linking historical raw progress must not overtake a more recently accepted web position.
        await manager.query(
          `INSERT INTO koreader_book_progress(user_id,book_id,percentage,source,device,native_progress,revision,updated_at)
           SELECT user_id,$3,(payload->>'percentage')::double precision,'koreader',payload->>'device',
                  payload->>'progress',revision,to_timestamp((payload->>'timestamp')::double precision)
           FROM koreader_native_progress WHERE user_id=$1 AND document=$2
           ON CONFLICT(user_id,book_id) DO UPDATE SET percentage=EXCLUDED.percentage,source='koreader',
             device=EXCLUDED.device,native_progress=EXCLUDED.native_progress,location=NULL,
             revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at
           WHERE koreader_book_progress.revision<EXCLUDED.revision`,
          [actor.id, document, match.bookId],
        );
      }
      return { pending: false as const, match };
    });
    if (result.pending) throw new ServiceUnavailableException('Identity indexing in progress; retry resolution');
    if (!result.match) throw new NotFoundException('Document is not a verified accessible EPUB');
    return { ...result.match, capabilities: { portableLocation: 1, passageAnchor: 1 } };
  }
}
