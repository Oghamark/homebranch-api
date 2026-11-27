import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';

interface MetadataMergeLogger {
  warn(message: string): void;
  log(message: string): void;
}

export interface MergeResult {
  merged: SyncableMetadata;
  dbUpdated: boolean;
  fileUpdated: boolean;
  conflicts: string[];
}

const SYNCABLE_FIELDS: (keyof SyncableMetadata)[] = [
  'title',
  'author',
  'language',
  'publisher',
  'publishedYear',
  'isbn',
  'summary',
  'genres',
  'series',
  'seriesPosition',
];

export class MetadataMerger {
  static merge(
    fileMetadata: SyncableMetadata,
    dbMetadata: SyncableMetadata,
    lastSynced: SyncableMetadata | null,
    logger?: MetadataMergeLogger,
    preferredDbFields: (keyof SyncableMetadata)[] = [],
  ): MergeResult {
    if (!lastSynced) {
      const merged = { ...fileMetadata };
      let fileUpdated = false;
      for (const field of preferredDbFields) {
        MetadataMerger.setField(merged, field, dbMetadata[field]);
        if (
          !MetadataMerger.valuesEqual(
            MetadataMerger.normalize(fileMetadata[field]),
            MetadataMerger.normalize(dbMetadata[field]),
          )
        ) {
          fileUpdated = true;
        }
      }
      return {
        merged,
        dbUpdated: true,
        fileUpdated,
        conflicts: [],
      };
    }

    const merged: SyncableMetadata = { ...dbMetadata };
    let dbUpdated = false;
    let fileUpdated = false;
    const conflicts: string[] = [];

    for (const field of SYNCABLE_FIELDS) {
      const fileVal = MetadataMerger.normalize(fileMetadata[field]);
      const dbVal = MetadataMerger.normalize(dbMetadata[field]);
      const syncedVal = MetadataMerger.normalize(lastSynced[field]);

      if (preferredDbFields.includes(field)) {
        MetadataMerger.setField(merged, field, dbMetadata[field]);
        if (!MetadataMerger.valuesEqual(fileVal, dbVal)) fileUpdated = true;
        continue;
      }

      const fileChanged = !MetadataMerger.valuesEqual(fileVal, syncedVal);
      const dbChanged = !MetadataMerger.valuesEqual(dbVal, syncedVal);

      if (fileChanged && !dbChanged) {
        MetadataMerger.setField(merged, field, fileMetadata[field]);
        dbUpdated = true;
      } else if (!fileChanged && dbChanged) {
        MetadataMerger.setField(merged, field, dbMetadata[field]);
        fileUpdated = true;
      } else if (fileChanged && dbChanged) {
        MetadataMerger.setField(merged, field, fileMetadata[field]);
        dbUpdated = true;
        conflicts.push(field);
        logger?.warn(`Metadata conflict on "${field}": file="${String(fileVal)}" wins over db="${String(dbVal)}"`);
      }
    }

    return { merged, dbUpdated, fileUpdated, conflicts };
  }

  private static setField<K extends keyof SyncableMetadata>(
    target: SyncableMetadata,
    field: K,
    value: SyncableMetadata[K],
  ): void {
    target[field] = value;
  }

  private static normalize(value: SyncableMetadata[keyof SyncableMetadata]): unknown {
    if (value === undefined || value === null || value === '') return undefined;
    if (Array.isArray(value)) return value.length === 0 ? undefined : [...value].sort();
    return value;
  }

  private static valuesEqual(a: unknown, b: unknown): boolean {
    if (a === undefined && b === undefined) return true;
    if (a === undefined || b === undefined) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
      return JSON.stringify(a) === JSON.stringify(b);
    }
    return a === b;
  }
}
