import { EntityManager } from 'typeorm';
import { PortableLocation } from '../book/publication/epub-location';

/** The lock is held until commit, unlike a sequence whose values can commit out of order. */
export async function lockSyncUser(manager: EntityManager, userId: string): Promise<string> {
  await manager.query(`INSERT INTO koreader_revision(user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  const [row] = await manager.query<{ revision: string }[]>(
    `SELECT revision FROM koreader_revision WHERE user_id=$1 FOR UPDATE`,
    [userId],
  );
  return row.revision;
}

export async function nextSyncRevision(manager: EntityManager, userId: string): Promise<string> {
  const [rows] = await manager.query<[{ revision: string }[], number]>(
    `UPDATE koreader_revision SET revision=revision+1 WHERE user_id=$1 RETURNING revision`,
    [userId],
  );
  return rows[0].revision;
}

export async function acceptWebProgress(
  manager: EntityManager,
  params: {
    userId: string;
    bookId: string;
    percentage?: number | null;
    deviceName: string;
    location?: PortableLocation;
  },
): Promise<string> {
  const revision = await nextSyncRevision(manager, params.userId);
  await manager.query(
    `INSERT INTO koreader_book_progress(user_id,book_id,percentage,source,device,native_progress,revision,location)
     VALUES($1,$2,$3,'web',$4,NULL,$5,$6) ON CONFLICT(user_id,book_id) DO UPDATE
     SET percentage=EXCLUDED.percentage,source='web',device=EXCLUDED.device,native_progress=NULL,
         revision=EXCLUDED.revision,location=EXCLUDED.location,updated_at=clock_timestamp()`,
    [
      params.userId,
      params.bookId,
      params.percentage ?? null,
      params.deviceName,
      revision,
      params.location ? JSON.stringify(params.location) : null,
    ],
  );
  return revision;
}
