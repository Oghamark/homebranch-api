import { QueryRunner } from 'typeorm';
import { AddBookClubPrivacyProgress1790000000007 } from 'src/migrations/1790000000007-AddBookClubPrivacyProgress';

describe('AddBookClubPrivacyProgress migration', () => {
  it('stores member-only mappings and coarse opt-in progress with database constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubPrivacyProgress1790000000007().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('"progress_sharing_enabled" boolean NOT NULL DEFAULT false');
    expect(sql).toContain('UNIQUE ("member_id", "milestone_id")');
    expect(sql).toContain("'not_started', 'in_progress', 'completed'");
    expect(sql).toContain('"percentage" >= 0 AND "percentage" <= 100');
    expect(sql).toContain('REFERENCES "book_club_member_entity"("id") ON DELETE CASCADE');
    expect(sql).toContain('REFERENCES "book_club_milestone_entity"("id") ON DELETE CASCADE');
    expect(sql).not.toMatch(/book_id|file_content_hash|format|cfi|page_number|timestamp|annotation|history/i);
  });

  it('rolls back only the member mapping/progress tables and sharing preference', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubPrivacyProgress1790000000007().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('DROP TABLE "book_club_milestone_progress_entity"');
    expect(sql).toContain('DROP TABLE "book_club_milestone_mapping_entity"');
    expect(sql).toContain('DROP COLUMN "progress_sharing_enabled"');
    expect(sql).not.toContain('DROP TABLE "book_club_entity"');
  });
});
