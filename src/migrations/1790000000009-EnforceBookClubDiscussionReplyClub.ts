import { MigrationInterface, QueryRunner } from 'typeorm';

export class EnforceBookClubDiscussionReplyClub1790000000009 implements MigrationInterface {
  name = 'EnforceBookClubDiscussionReplyClub1790000000009';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "book_club_discussion_thread_entity" ADD CONSTRAINT "UQ_discussion_thread_club_id" UNIQUE ("club_id", "id")',
    );
    await queryRunner.query(
      'ALTER TABLE "book_club_discussion_reply_entity" ADD CONSTRAINT "FK_discussion_reply_club_thread" FOREIGN KEY ("club_id", "thread_id") REFERENCES "book_club_discussion_thread_entity" ("club_id", "id") ON DELETE CASCADE',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "book_club_discussion_reply_entity" DROP CONSTRAINT "FK_discussion_reply_club_thread"',
    );
    await queryRunner.query(
      'ALTER TABLE "book_club_discussion_thread_entity" DROP CONSTRAINT "UQ_discussion_thread_club_id"',
    );
  }
}
