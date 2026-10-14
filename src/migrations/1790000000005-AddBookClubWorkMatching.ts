import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBookClubWorkMatching1790000000005 implements MigrationInterface {
  name = 'AddBookClubWorkMatching1790000000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" ADD COLUMN "isbn" character varying`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" ADD COLUMN "external_work_id" character varying`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" ADD COLUMN "edition_id" character varying`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" ADD COLUMN "series" character varying`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" ADD COLUMN "series_position" integer`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN "external_work_id" character varying`);
    await queryRunner.query(`ALTER TABLE "book_entity" ADD COLUMN "edition_id" character varying`);
    await queryRunner.query(`ALTER TABLE "book_format_entity" ADD COLUMN "external_work_id" character varying`);
    await queryRunner.query(`ALTER TABLE "book_format_entity" ADD COLUMN "edition_id" character varying`);
    await queryRunner.query(
      `ALTER TABLE "book_club_reading_copy_entity" ADD COLUMN "association_method" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "book_club_reading_copy_entity" ADD COLUMN "confidence" double precision`);
    await queryRunner.query(`
      UPDATE "book_club_reading_copy_entity"
      SET "association_method" = 'manual_confirmation', "confidence" = 1
      WHERE "source" <> 'none'
    `);
    await queryRunner.query(`
      ALTER TABLE "book_club_reading_copy_entity"
      ADD CONSTRAINT "CHK_book_club_reading_copy_match_method"
      CHECK ("association_method" IS NULL OR "association_method" IN ('identifier', 'metadata_candidate', 'manual_confirmation'))
    `);
    await queryRunner.query(`
      ALTER TABLE "book_club_reading_copy_entity"
      ADD CONSTRAINT "CHK_book_club_reading_copy_confidence"
      CHECK ("confidence" IS NULL OR ("confidence" >= 0 AND "confidence" <= 1))
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_book_entity_external_work_id" ON "book_entity" ("external_work_id") WHERE "external_work_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_book_entity_edition_id" ON "book_entity" ("edition_id") WHERE "edition_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_book_format_external_work_id" ON "book_format_entity" ("external_work_id") WHERE "external_work_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_book_format_edition_id" ON "book_format_entity" ("edition_id") WHERE "edition_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_book_format_edition_id"`);
    await queryRunner.query(`DROP INDEX "IDX_book_format_external_work_id"`);
    await queryRunner.query(`DROP INDEX "IDX_book_entity_edition_id"`);
    await queryRunner.query(`DROP INDEX "IDX_book_entity_external_work_id"`);
    await queryRunner.query(
      `ALTER TABLE "book_club_reading_copy_entity" DROP CONSTRAINT "CHK_book_club_reading_copy_confidence"`,
    );
    await queryRunner.query(
      `ALTER TABLE "book_club_reading_copy_entity" DROP CONSTRAINT "CHK_book_club_reading_copy_match_method"`,
    );
    await queryRunner.query(`ALTER TABLE "book_club_reading_copy_entity" DROP COLUMN "confidence"`);
    await queryRunner.query(`ALTER TABLE "book_club_reading_copy_entity" DROP COLUMN "association_method"`);
    await queryRunner.query(`ALTER TABLE "book_format_entity" DROP COLUMN "edition_id"`);
    await queryRunner.query(`ALTER TABLE "book_format_entity" DROP COLUMN "external_work_id"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN "edition_id"`);
    await queryRunner.query(`ALTER TABLE "book_entity" DROP COLUMN "external_work_id"`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" DROP COLUMN "series_position"`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" DROP COLUMN "series"`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" DROP COLUMN "edition_id"`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" DROP COLUMN "external_work_id"`);
    await queryRunner.query(`ALTER TABLE "book_club_work_entity" DROP COLUMN "isbn"`);
  }
}
