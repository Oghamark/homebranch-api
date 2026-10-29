import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookClubPrivacyProgress1790000000007 implements MigrationInterface {
  name = 'AddBookClubPrivacyProgress1790000000007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "book_club_member_entity" ADD COLUMN "progress_sharing_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(`
      CREATE TABLE "book_club_milestone_mapping_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "member_id" uuid NOT NULL,
        "work_id" uuid NOT NULL,
        "milestone_id" uuid NOT NULL,
        "member_label" character varying(120) NOT NULL,
        "member_position" integer,
        CONSTRAINT "PK_book_club_milestone_mapping_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_milestone_mapping_member_milestone" UNIQUE ("member_id", "milestone_id"),
        CONSTRAINT "CHK_book_club_milestone_mapping_position" CHECK ("member_position" IS NULL OR "member_position" > 0),
        CONSTRAINT "FK_book_club_mapping_member" FOREIGN KEY ("member_id")
          REFERENCES "book_club_member_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_mapping_work" FOREIGN KEY ("work_id")
          REFERENCES "book_club_work_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_mapping_milestone" FOREIGN KEY ("milestone_id")
          REFERENCES "book_club_milestone_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "book_club_milestone_progress_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "member_id" uuid NOT NULL,
        "work_id" uuid NOT NULL,
        "milestone_id" uuid NOT NULL,
        "status" character varying NOT NULL,
        "percentage" integer,
        CONSTRAINT "PK_book_club_milestone_progress_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_milestone_progress_member_milestone" UNIQUE ("member_id", "milestone_id"),
        CONSTRAINT "CHK_book_club_milestone_progress_status" CHECK ("status" IN ('not_started', 'in_progress', 'completed')),
        CONSTRAINT "CHK_book_club_milestone_progress_percentage" CHECK ("percentage" IS NULL OR ("percentage" >= 0 AND "percentage" <= 100)),
        CONSTRAINT "FK_book_club_progress_member" FOREIGN KEY ("member_id")
          REFERENCES "book_club_member_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_progress_work" FOREIGN KEY ("work_id")
          REFERENCES "book_club_work_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_progress_milestone" FOREIGN KEY ("milestone_id")
          REFERENCES "book_club_milestone_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "book_club_milestone_progress_entity"`);
    await queryRunner.query(`DROP TABLE "book_club_milestone_mapping_entity"`);
    await queryRunner.query(`ALTER TABLE "book_club_member_entity" DROP COLUMN "progress_sharing_enabled"`);
  }
}
