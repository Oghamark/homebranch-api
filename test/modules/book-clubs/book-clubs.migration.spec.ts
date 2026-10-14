import { QueryRunner } from 'typeorm';
import { CreateBookClubCore1790000000003 } from 'src/migrations/1790000000003-CreateBookClubCore';

describe('CreateBookClubCore migration', () => {
  it('creates instance-local clubs, separate logical work and role-scoped memberships', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateBookClubCore1790000000003().up(queryRunner);

    const statements = query.mock.calls.map(([sql]) => sql as string);
    expect(statements.join('\n')).toContain('CREATE TABLE "book_club_entity"');
    expect(statements.join('\n')).toContain('CREATE TABLE "book_club_member_entity"');
    expect(statements.join('\n')).toContain("'owner', 'moderator', 'member'");
    expect(statements.join('\n')).toContain("'private', 'instance_visible'");
    const memberTable = statements.find((sql) => sql.includes('CREATE TABLE "book_club_member_entity"'));
    expect(memberTable).toContain('personal_book_id');
    const workTable = statements.find((sql) => sql.includes('CREATE TABLE "book_club_work_entity"'));
    expect(workTable).toContain('club_id');
    expect(workTable).not.toMatch(/book_id|file_content_hash|edition/i);
  });

  it('drops only the book club schema on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateBookClubCore1790000000003().down(queryRunner);

    expect(query.mock.calls.map(([sql]) => sql as string).join('\n')).toContain('DROP TABLE "book_club_work_entity"');
    expect(query.mock.calls.map(([sql]) => sql as string).join('\n')).not.toContain('book_entity');
  });
});
