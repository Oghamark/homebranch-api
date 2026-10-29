import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookClubCore1790000000003 implements MigrationInterface {
  name = 'CreateBookClubCore1790000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "book_club_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(120) NOT NULL,
        "description" text,
        "visibility" character varying NOT NULL DEFAULT 'private',
        "status" character varying NOT NULL DEFAULT 'active',
        "owner_user_id" character varying NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_book_club_entity" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_book_club_visibility" CHECK ("visibility" IN ('private', 'instance_visible')),
        CONSTRAINT "CHK_book_club_status" CHECK ("status" IN ('active', 'archived'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "book_club_member_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "club_id" uuid NOT NULL,
        "user_id" character varying NOT NULL,
        "personal_book_id" uuid,
        "role" character varying NOT NULL DEFAULT 'member',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_book_club_member_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_member_club_user" UNIQUE ("club_id", "user_id"),
        CONSTRAINT "CHK_book_club_member_role" CHECK ("role" IN ('owner', 'moderator', 'member')),
        CONSTRAINT "FK_book_club_member_club" FOREIGN KEY ("club_id")
          REFERENCES "book_club_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_member_personal_book" FOREIGN KEY ("personal_book_id")
          REFERENCES "book_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_book_club_member_one_owner" ON "book_club_member_entity" ("club_id") WHERE "role" = 'owner'`,
    );
    await queryRunner.query(`CREATE INDEX "IDX_book_club_member_user_id" ON "book_club_member_entity" ("user_id")`);

    await queryRunner.query(`
      CREATE TABLE "book_club_work_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "club_id" uuid NOT NULL,
        "title" character varying(300) NOT NULL,
        "author" character varying(300) NOT NULL,
        CONSTRAINT "PK_book_club_work_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_work_club_id" UNIQUE ("club_id"),
        CONSTRAINT "FK_book_club_work_club" FOREIGN KEY ("club_id")
          REFERENCES "book_club_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_book_club_visibility_status" ON "book_club_entity" ("visibility", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_book_club_visibility_status"`);
    await queryRunner.query(`DROP TABLE "book_club_work_entity"`);
    await queryRunner.query(`DROP INDEX "IDX_book_club_member_user_id"`);
    await queryRunner.query(`DROP INDEX "UQ_book_club_member_one_owner"`);
    await queryRunner.query(`DROP TABLE "book_club_member_entity"`);
    await queryRunner.query(`DROP TABLE "book_club_entity"`);
  }
}
