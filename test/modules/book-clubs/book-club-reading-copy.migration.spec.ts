import { QueryRunner, getMetadataArgsStorage } from 'typeorm';
import { BookClubReadingCopyEntity } from 'src/modules/book-clubs/entities/book-club-reading-copy.entity';
import { BookClubWorkEntity } from 'src/modules/book-clubs/entities/book-club-work.entity';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { CreateBookClubReadingCopy1790000000004 } from 'src/migrations/1790000000004-CreateBookClubReadingCopy';

describe('CreateBookClubReadingCopy migration', () => {
  it('creates one source-aware association per member and logical work', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateBookClubReadingCopy1790000000004().up(queryRunner);

    const statements = query.mock.calls.map(([sql]) => sql as string).join('\n');
    expect(statements).toContain('CREATE TABLE "book_club_reading_copy_entity"');
    expect(statements).toContain('UNIQUE ("member_id", "work_id")');
    expect(statements).toContain("'shared', 'personal', 'none'");
    expect(statements).toContain('ON DELETE SET NULL');
    expect(statements).not.toMatch(/annotation|position|history/i);

    const columns = getMetadataArgsStorage()
      .columns.filter((column) => column.target === BookClubReadingCopyEntity)
      .map((column) => column.propertyName);
    expect(columns).toEqual(expect.arrayContaining(['memberId', 'workId', 'bookId', 'source']));
    expect(columns).not.toContain('clubId');
  });

  it('rolls back only the reading-copy association table', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await new CreateBookClubReadingCopy1790000000004().down(queryRunner);

    expect(query).toHaveBeenCalledWith('DROP TABLE "book_club_reading_copy_entity"');
  });

  it('stores match evidence on the association and stable work identifiers on local metadata', () => {
    const columnsFor = (target: object) =>
      getMetadataArgsStorage()
        .columns.filter((column) => column.target === target)
        .map((column) => column.propertyName);

    expect(columnsFor(BookClubReadingCopyEntity)).toEqual(expect.arrayContaining(['associationMethod', 'confidence']));
    expect(columnsFor(BookClubWorkEntity)).toEqual(
      expect.arrayContaining(['isbn', 'externalWorkId', 'editionId', 'series', 'seriesPosition']),
    );
    expect(columnsFor(BookEntity)).toEqual(expect.arrayContaining(['externalWorkId', 'editionId']));
    expect(columnsFor(BookFormatEntity)).toEqual(expect.arrayContaining(['externalWorkId', 'editionId']));
  });
});
