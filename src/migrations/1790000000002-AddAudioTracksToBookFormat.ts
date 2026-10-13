import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddAudioTracksToBookFormat1790000000002 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'book_format_entity',
      new TableColumn({ name: 'audio_tracks', type: 'jsonb', isNullable: true }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('book_format_entity', 'audio_tracks');
  }
}
