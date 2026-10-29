import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookClubSchedules1790000000006 implements MigrationInterface {
  name = 'AddBookClubSchedules1790000000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_club_entity" ADD COLUMN "start_date" date`);
    await queryRunner.query(`ALTER TABLE "book_club_entity" ADD COLUMN "completion_date" date`);
    await queryRunner.query(`
      ALTER TABLE "book_club_entity"
      ADD CONSTRAINT "CHK_book_club_schedule_dates"
      CHECK ("start_date" IS NULL OR "completion_date" IS NULL OR "start_date" <= "completion_date")
    `);
    await queryRunner.query(`
      CREATE TABLE "book_club_milestone_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "work_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying NOT NULL,
        "position" integer NOT NULL,
        CONSTRAINT "PK_book_club_milestone_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_milestone_work_position" UNIQUE ("work_id", "position"),
        CONSTRAINT "CHK_book_club_milestone_kind" CHECK ("kind" IN ('part', 'chapter', 'checkpoint')),
        CONSTRAINT "CHK_book_club_milestone_position" CHECK ("position" > 0),
        CONSTRAINT "FK_book_club_milestone_work" FOREIGN KEY ("work_id")
          REFERENCES "book_club_work_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "book_club_milestone_entity"`);
    await queryRunner.query(`ALTER TABLE "book_club_entity" DROP CONSTRAINT "CHK_book_club_schedule_dates"`);
    await queryRunner.query(`ALTER TABLE "book_club_entity" DROP COLUMN "completion_date"`);
    await queryRunner.query(`ALTER TABLE "book_club_entity" DROP COLUMN "start_date"`);
  }
}
