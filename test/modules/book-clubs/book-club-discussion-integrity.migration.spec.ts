import { QueryRunner } from 'typeorm';
import { EnforceBookClubDiscussionReplyClub1790000000009 } from 'src/migrations/1790000000009-EnforceBookClubDiscussionReplyClub';

describe('EnforceBookClubDiscussionReplyClub migration', () => {
  it('prevents replies from referencing a thread in another club', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new EnforceBookClubDiscussionReplyClub1790000000009().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('UNIQUE ("club_id", "id")');
    expect(sql).toContain('FOREIGN KEY ("club_id", "thread_id")');
    expect(sql).toContain('REFERENCES "book_club_discussion_thread_entity" ("club_id", "id") ON DELETE CASCADE');
  });

  it('rolls back only the reply-to-thread club integrity constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new EnforceBookClubDiscussionReplyClub1790000000009().down({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    expect(sql).toContain('DROP CONSTRAINT "FK_discussion_reply_club_thread"');
    expect(sql).toContain('DROP CONSTRAINT "UQ_discussion_thread_club_id"');
  });
});
