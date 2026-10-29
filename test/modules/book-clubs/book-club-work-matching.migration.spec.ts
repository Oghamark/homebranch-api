import { QueryRunner } from 'typeorm';
import { AddBookClubWorkMatching1790000000005 } from 'src/migrations/1790000000005-AddBookClubWorkMatching';

describe('AddBookClubWorkMatching migration', () => {
  it('adds nullable match metadata while preserving existing association uniqueness', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubWorkMatching1790000000005().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('ALTER TABLE "book_club_work_entity"');
    expect(sql).toContain('"external_work_id"');
    expect(sql).toContain('ALTER TABLE "book_entity"');
    expect(sql).toContain('ALTER TABLE "book_format_entity"');
    expect(sql).toContain('"association_method"');
    expect(sql).toContain("'identifier', 'metadata_candidate', 'manual_confirmation'");
    expect(sql).toContain('"confidence"');
    expect(sql).not.toMatch(/file_content_hash|annotation|reading.position|history/i);
    expect(sql).not.toMatch(/DROP|DELETE FROM/i);
  });

  it('rolls back only the added matching columns', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubWorkMatching1790000000005().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('DROP COLUMN "association_method"');
    expect(sql).toContain('DROP COLUMN "external_work_id"');
    expect(sql).toContain('DROP COLUMN "edition_id"');
    expect(sql).not.toContain('DROP TABLE');
  });
});
