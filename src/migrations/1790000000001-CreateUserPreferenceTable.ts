import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserPreferenceTable1790000000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_preference_entity" (
        "user_id" character varying NOT NULL,
        "kindle_email" character varying,
        CONSTRAINT "PK_user_preference_entity" PRIMARY KEY ("user_id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_preference_entity"`);
  }
}
