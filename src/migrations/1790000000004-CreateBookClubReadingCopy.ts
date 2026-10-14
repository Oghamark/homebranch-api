import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBookClubReadingCopy1790000000004 implements MigrationInterface {
  name = 'CreateBookClubReadingCopy1790000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "book_club_reading_copy_entity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "member_id" uuid NOT NULL,
        "work_id" uuid NOT NULL,
        "book_id" uuid,
        "source" character varying NOT NULL DEFAULT 'none',
        CONSTRAINT "PK_book_club_reading_copy_entity" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_book_club_reading_copy_member_work" UNIQUE ("member_id", "work_id"),
        CONSTRAINT "CHK_book_club_reading_copy_source" CHECK ("source" IN ('shared', 'personal', 'none')),
        CONSTRAINT "CHK_book_club_reading_copy_none_has_no_book" CHECK ("source" <> 'none' OR "book_id" IS NULL),
        CONSTRAINT "FK_book_club_reading_copy_member" FOREIGN KEY ("member_id")
          REFERENCES "book_club_member_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_reading_copy_work" FOREIGN KEY ("work_id")
          REFERENCES "book_club_work_entity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT "FK_book_club_reading_copy_book" FOREIGN KEY ("book_id")
          REFERENCES "book_entity"("id") ON DELETE SET NULL ON UPDATE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE "book_club_reading_copy_entity"');
  }
}
