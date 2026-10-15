import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookClubDiscussions1790000000008 implements MigrationInterface {
  name = 'AddBookClubDiscussions1790000000008';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "book_club_discussion_thread_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "club_id" uuid NOT NULL, "author_user_id" uuid NOT NULL, "title" character varying(160) NOT NULL, "body" text NOT NULL, "spoiler" boolean NOT NULL DEFAULT false, "locked" boolean NOT NULL DEFAULT false, "pinned" boolean NOT NULL DEFAULT false, "hidden" boolean NOT NULL DEFAULT false, "deleted" boolean NOT NULL DEFAULT false, "prompt_kind" boolean NOT NULL DEFAULT false, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), CONSTRAINT "PK_book_club_discussion_thread" PRIMARY KEY ("id"), CONSTRAINT "FK_discussion_thread_club" FOREIGN KEY ("club_id") REFERENCES "book_club_entity"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discussion_thread_club" ON "book_club_discussion_thread_entity" ("club_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "book_club_discussion_reply_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "club_id" uuid NOT NULL, "thread_id" uuid NOT NULL, "author_user_id" uuid NOT NULL, "body" text NOT NULL, "spoiler" boolean NOT NULL DEFAULT false, "hidden" boolean NOT NULL DEFAULT false, "deleted" boolean NOT NULL DEFAULT false, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(), CONSTRAINT "PK_book_club_discussion_reply" PRIMARY KEY ("id"), CONSTRAINT "FK_discussion_reply_club" FOREIGN KEY ("club_id") REFERENCES "book_club_entity"("id") ON DELETE CASCADE, CONSTRAINT "FK_discussion_reply_thread" FOREIGN KEY ("thread_id") REFERENCES "book_club_discussion_thread_entity"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_discussion_reply_thread" ON "book_club_discussion_reply_entity" ("thread_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "book_club_moderation_audit_entity" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "club_id" uuid NOT NULL, "actor_user_id" uuid NOT NULL, "action" character varying(32) NOT NULL, "target_type" character varying(16) NOT NULL, "target_id" uuid NOT NULL, "created_at" timestamp NOT NULL DEFAULT now(), CONSTRAINT "PK_book_club_moderation_audit" PRIMARY KEY ("id"), CONSTRAINT "FK_moderation_audit_club" FOREIGN KEY ("club_id") REFERENCES "book_club_entity"("id") ON DELETE CASCADE)`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "book_club_moderation_audit_entity"');
    await queryRunner.query('DROP TABLE "book_club_discussion_reply_entity"');
    await queryRunner.query('DROP TABLE "book_club_discussion_thread_entity"');
  }
}
