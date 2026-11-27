import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefreshM4bChapters1790000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE book_format_entity
      SET audio_chapters = NULL
      WHERE format = 'M4B' AND audio_chapters = '[]'::jsonb
    `);
  }

  public async down(): Promise<void> {}
}
