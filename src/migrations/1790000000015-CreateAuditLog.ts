import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLog1790000000015 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "audit_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "actor_id" uuid,
        "actor_label" varchar(320),
        "method" varchar(10) NOT NULL,
        "route" varchar(500) NOT NULL,
        "resource_ids" jsonb NOT NULL DEFAULT '{}',
        "status_code" integer NOT NULL,
        "outcome" varchar(10) NOT NULL,
        CONSTRAINT "PK_audit_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_created_at" ON "audit_log" ("created_at", "id")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_log_actor_id" ON "audit_log" ("actor_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "audit_log"`);
  }
}
