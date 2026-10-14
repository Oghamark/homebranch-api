import { matchBookClubWork } from 'src/modules/book-clubs/book-club-work-matcher';

describe('Book club logical-work matching', () => {
  it('matches a work identifier across different formats without comparing file hashes', () => {
    const matches = matchBookClubWork({ title: 'The Hobbit', author: 'J. R. R. Tolkien', isbn: '9780261102217' }, [
      {
        id: 'book-epub',
        title: 'The Hobbit',
        author: 'J. R. R. Tolkien',
        formats: [{ format: 'epub', isbn: '9780261102217', fileContentHash: 'epub-hash' }],
      },
      {
        id: 'book-audio',
        title: 'The Hobbit: An Unexpected Journey',
        author: 'J. R. R. Tolkien',
        formats: [{ format: 'mp3', isbn: '9780261102217', fileContentHash: 'audio-hash' }],
      },
    ] as never);

    expect(matches).toEqual([
      { bookId: 'book-audio', method: 'identifier', confidence: 1 },
      { bookId: 'book-epub', method: 'identifier', confidence: 1 },
    ]);
    expect(JSON.stringify(matches)).not.toMatch(/hash|format|content/i);
  });

  it('uses normalized format metadata and series volume when stable identifiers are missing', () => {
    const matches = matchBookClubWork(
      {
        title: 'The Long Way to a Small, Angry Planet',
        author: 'Becky Chambers',
        series: 'Wayfarers',
        seriesPosition: 1,
      },
      [
        {
          id: 'book-pdf',
          title: 'Untitled import',
          author: 'Unknown',
          formats: [
            {
              format: 'pdf',
              title: 'The Long Way to a Small Angry Planet',
              author: 'Becky Chambers',
              series: 'Wayfarers',
              seriesPosition: 1,
            },
          ],
        },
      ] as never,
    );

    expect(matches).toEqual([{ bookId: 'book-pdf', method: 'metadata_candidate', confidence: 0.75 }]);
  });

  it('uses the parent book author when a matching edition title has no format author', () => {
    const matches = matchBookClubWork({ title: 'The Edition Title', author: 'A. Writer' }, [
      {
        id: 'book-pdf',
        title: 'Different parent title',
        author: 'A. Writer',
        formats: [{ format: 'pdf', title: 'The Edition Title' }],
      },
    ] as never);

    expect(matches).toEqual([{ bookId: 'book-pdf', method: 'metadata_candidate', confidence: 0.75 }]);
  });

  it('rejects a same-title false positive when external work identifiers conflict', () => {
    expect(
      matchBookClubWork({ title: 'The Same Story', author: 'A. Writer', externalWorkId: 'work-a' }, [
        { id: 'different-work', title: 'The Same Story', author: 'A. Writer', externalWorkId: 'work-b' },
      ]),
    ).toEqual([]);
  });

  it('does not accept an ISBN match when the external work identity conflicts', () => {
    expect(
      matchBookClubWork(
        { title: 'The Same Story', author: 'A. Writer', isbn: '9780000000000', externalWorkId: 'work-a' },
        [
          {
            id: 'conflicting-work',
            title: 'The Same Story',
            author: 'A. Writer',
            isbn: '9780000000000',
            externalWorkId: 'work-b',
          },
        ],
      ),
    ).toEqual([]);
  });

  it('does not match metadata when title and author normalize to empty strings', () => {
    expect(
      matchBookClubWork({ title: '!!!', author: '???' }, [{ id: 'punctuation-only', title: '---', author: '...' }]),
    ).toEqual([]);
  });
});
