import { QueryRunner } from 'typeorm';
import { AddBookClubSchedules1790000000006 } from 'src/migrations/1790000000006-AddBookClubSchedules';

describe('AddBookClubSchedules migration', () => {
  it('adds optional club dates and format-neutral ordered milestones with cascade lifecycle', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubSchedules1790000000006().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('"start_date" date');
    expect(sql).toContain('"completion_date" date');
    expect(sql).toContain('"start_date" <= "completion_date"');
    expect(sql).toContain("'part', 'chapter', 'checkpoint'");
    expect(sql).toContain('UNIQUE ("work_id", "position")');
    expect(sql).toContain('REFERENCES "book_club_work_entity"("id") ON DELETE CASCADE');
    expect(sql).not.toMatch(/book_id|file_content_hash|format|cfi|page_number|timestamp|annotation|history/i);
  });

  it('rolls back only the schedule table and date columns', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubSchedules1790000000006().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('DROP TABLE "book_club_milestone_entity"');
    expect(sql).toContain('DROP COLUMN "completion_date"');
    expect(sql).toContain('DROP COLUMN "start_date"');
    expect(sql).not.toContain('DROP TABLE "book_club_entity"');
  });
});
