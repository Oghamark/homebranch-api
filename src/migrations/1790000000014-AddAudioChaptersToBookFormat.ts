import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAudioChaptersToBookFormat1790000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'book_format_entity',
      new TableColumn({ name: 'audio_chapters', type: 'jsonb', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('book_format_entity', 'audio_chapters');
  }
}
