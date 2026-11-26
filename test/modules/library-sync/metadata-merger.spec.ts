import { MetadataMerger } from 'src/modules/library-sync/metadata-merger';
import { SyncableMetadata } from 'src/common/value-objects/syncable-metadata';

describe('MetadataMerger', () => {
  const baseMetadata: SyncableMetadata = {
    title: 'Original Title',
    author: 'Original Author',
    language: 'en',
    publisher: 'Publisher',
    publishedYear: 2020,
    isbn: '1234567890',
    summary: 'A summary',
    genres: ['fiction'],
    series: 'Series One',
    seriesPosition: 1,
  };

  test('First sync (no snapshot) uses file metadata and marks DB updated', () => {
    const result = MetadataMerger.merge(baseMetadata, baseMetadata, null);

    expect(result.dbUpdated).toBe(true);
    expect(result.fileUpdated).toBe(false);
    expect(result.conflicts).toEqual([]);
    expect(result.merged).toEqual(baseMetadata);
  });

  test('No changes on either side results in no updates', () => {
    const result = MetadataMerger.merge(baseMetadata, baseMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(false);
    expect(result.fileUpdated).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  test.each([null, baseMetadata, { ...baseMetadata, summary: 'test2' }])(
    'explicitly edited fields win over the file with snapshot %p',
    (snapshot) => {
      const file = { ...baseMetadata, summary: 'test' };
      const db = { ...baseMetadata, summary: 'test2' };
      const result = MetadataMerger.merge(file, db, snapshot, undefined, ['summary']);

      expect(result.merged.summary).toBe('test2');
      expect(result.fileUpdated).toBe(true);
      expect(result.conflicts).not.toContain('summary');
    },
  );

  test('File-only change updates DB', () => {
    const fileMetadata = { ...baseMetadata, title: 'New File Title' };

    const result = MetadataMerger.merge(fileMetadata, baseMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(true);
    expect(result.fileUpdated).toBe(false);
    expect(result.merged.title).toBe('New File Title');
    expect(result.conflicts).toEqual([]);
  });

  test('DB-only change updates file', () => {
    const dbMetadata = { ...baseMetadata, author: 'New DB Author' };

    const result = MetadataMerger.merge(baseMetadata, dbMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(false);
    expect(result.fileUpdated).toBe(true);
    expect(result.merged.author).toBe('New DB Author');
    expect(result.conflicts).toEqual([]);
  });

  test('Both sides changed same field — file wins, conflict logged', () => {
    const fileMetadata = { ...baseMetadata, title: 'File Title' };
    const dbMetadata = { ...baseMetadata, title: 'DB Title' };

    const result = MetadataMerger.merge(fileMetadata, dbMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(true);
    expect(result.merged.title).toBe('File Title');
    expect(result.conflicts).toContain('title');
  });

  test('Both sides changed different fields — both applied, no conflict', () => {
    const fileMetadata = { ...baseMetadata, title: 'File Title' };
    const dbMetadata = { ...baseMetadata, author: 'DB Author' };

    const result = MetadataMerger.merge(fileMetadata, dbMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(true);
    expect(result.fileUpdated).toBe(true);
    expect(result.merged.title).toBe('File Title');
    expect(result.merged.author).toBe('DB Author');
    expect(result.conflicts).toEqual([]);
  });

  test('Genre array changes are detected', () => {
    const fileMetadata = { ...baseMetadata, genres: ['fiction', 'mystery'] };

    const result = MetadataMerger.merge(fileMetadata, baseMetadata, baseMetadata);

    expect(result.dbUpdated).toBe(true);
    expect(result.merged.genres).toEqual(['fiction', 'mystery']);
  });

  test('Empty and undefined values are treated as equal', () => {
    const fileMetadata = { ...baseMetadata, summary: '' };
    const snapshotWithNoSummary = { ...baseMetadata, summary: undefined };

    const result = MetadataMerger.merge(fileMetadata, baseMetadata, snapshotWithNoSummary);

    // summary was undefined in snapshot, '' in file (normalized to undefined = no change),
    // 'A summary' in DB (changed from undefined to 'A summary')
    // So DB changed, file didn't → DB wins
    expect(result.fileUpdated).toBe(true);
    expect(result.merged.summary).toBe('A summary');
  });

  test('Multiple conflicts are tracked', () => {
    const fileMetadata = { ...baseMetadata, title: 'F Title', author: 'F Author', isbn: 'F-ISBN' };
    const dbMetadata = { ...baseMetadata, title: 'D Title', author: 'D Author', isbn: 'D-ISBN' };

    const result = MetadataMerger.merge(fileMetadata, dbMetadata, baseMetadata);

    expect(result.conflicts).toContain('title');
    expect(result.conflicts).toContain('author');
    expect(result.conflicts).toContain('isbn');
    expect(result.conflicts).toHaveLength(3);
    expect(result.merged.title).toBe('F Title');
    expect(result.merged.author).toBe('F Author');
    expect(result.merged.isbn).toBe('F-ISBN');
  });
});
