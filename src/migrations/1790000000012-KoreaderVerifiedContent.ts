import { MigrationInterface, QueryRunner } from 'typeorm';

export class KoreaderVerifiedContent1790000000012 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE koreader_alias ADD COLUMN IF NOT EXISTS spine_hash varchar;
      ALTER TABLE koreader_alias ADD COLUMN IF NOT EXISTS selected boolean NOT NULL DEFAULT false;
      CREATE UNIQUE INDEX IF NOT EXISTS koreader_alias_selection ON koreader_alias(user_id,document) WHERE selected;
      ALTER TABLE koreader_annotation ADD COLUMN IF NOT EXISTS format_id uuid;
      ALTER TABLE koreader_annotation ALTER COLUMN format_id DROP NOT NULL;
      ALTER TABLE koreader_annotation DROP CONSTRAINT IF EXISTS koreader_annotation_format_id_fkey;
      ALTER TABLE koreader_annotation ADD CONSTRAINT koreader_annotation_format_id_fkey
        FOREIGN KEY(format_id) REFERENCES book_format_entity(id) ON DELETE SET NULL;
      UPDATE koreader_annotation a SET format_id=f.id FROM book_format_entity f
        WHERE a.format_id IS NULL AND f.book_id=a.book_id AND f.format='EPUB';
    `);
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`
      ALTER TABLE koreader_annotation DROP COLUMN format_id;
      DROP INDEX koreader_alias_selection;
      ALTER TABLE koreader_alias DROP COLUMN spine_hash,DROP COLUMN selected;
    `);
  }
}
