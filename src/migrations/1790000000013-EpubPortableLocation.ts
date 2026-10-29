import { MigrationInterface, QueryRunner } from 'typeorm';

export class EpubPortableLocation1790000000013 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE saved_position_entity ADD COLUMN location jsonb,
      ADD COLUMN revision bigint`);
    await queryRunner.query(`ALTER TABLE koreader_book_progress ADD COLUMN location jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE koreader_book_progress DROP COLUMN location`);
    await queryRunner.query(`ALTER TABLE saved_position_entity DROP COLUMN revision, DROP COLUMN location`);
  }
}
