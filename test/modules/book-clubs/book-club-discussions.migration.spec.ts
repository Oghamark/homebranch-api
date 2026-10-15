import { getMetadataArgsStorage, QueryRunner } from 'typeorm';
import { AddBookClubDiscussions1790000000008 } from 'src/migrations/1790000000008-AddBookClubDiscussions';
import { BookClubDiscussionReplyEntity } from 'src/modules/book-clubs/entities/book-club-discussion-reply.entity';
import { BookClubDiscussionThreadEntity } from 'src/modules/book-clubs/entities/book-club-discussion-thread.entity';
import { BookClubModerationAuditEntity } from 'src/modules/book-clubs/entities/book-club-moderation-audit.entity';

describe('AddBookClubDiscussions migration', () => {
  it('persists external-provider user IDs as varchar for threads, replies, and moderation audits', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    await new AddBookClubDiscussions1790000000008().up({ query } as unknown as QueryRunner);

    const sql = query.mock.calls.map(([statement]) => statement as string).join('\n');
    const externalUserId = 'auth0|provider-user_123';

    expect(externalUserId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(sql).toMatch(/"author_user_id" character varying NOT NULL/g);
    expect(sql.match(/"author_user_id" character varying NOT NULL/g)).toHaveLength(2);
    expect(sql).toContain('"actor_user_id" character varying NOT NULL');
    expect(sql).not.toContain('"author_user_id" uuid NOT NULL');
    expect(sql).not.toContain('"actor_user_id" uuid NOT NULL');

    const columns = getMetadataArgsStorage().columns;
    expect(
      columns.find(
        (column) => column.target === BookClubDiscussionThreadEntity && column.propertyName === 'authorUserId',
      )?.options.type,
    ).toBe('varchar');
    expect(
      columns.find(
        (column) => column.target === BookClubDiscussionReplyEntity && column.propertyName === 'authorUserId',
      )?.options.type,
    ).toBe('varchar');
    expect(
      columns.find((column) => column.target === BookClubModerationAuditEntity && column.propertyName === 'actorUserId')
        ?.options.type,
    ).toBe('varchar');
  });
});
