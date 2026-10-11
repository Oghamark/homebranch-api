import { parseFile } from 'music-metadata';
import { BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';

jest.mock('music-metadata', () => ({
  parseFile: jest.fn(),
}));

describe('BookFormatProcessingService MP3 metadata', () => {
  const service = new BookFormatProcessingService({} as never, {} as never, {} as never, {} as never, {} as never);
  const parseFileMock = jest.mocked(parseFile);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('extracts album metadata, track title, and embedded cover art', async () => {
    parseFileMock.mockResolvedValue({
      common: {
        album: 'The Album',
        title: 'Chapter One',
        albumartist: 'The Author',
        year: 2024,
        genre: ['Fiction'],
        picture: [{ format: 'image/png', data: new Uint8Array([1, 2, 3]) }],
      },
    } as Awaited<ReturnType<typeof parseFile>>);

    await expect(service.parseAudioMetadata('/tmp/chapter-one.mp3')).resolves.toMatchObject({
      albumTitle: 'The Album',
      albumArtist: 'The Author',
      trackTitle: 'Chapter One',
      bookMetadata: {
        title: 'The Album',
        author: 'The Author',
        publishedYear: 2024,
        genres: ['Fiction'],
        coverImageBuffer: Buffer.from([1, 2, 3]),
        coverImageMimeType: 'image/png',
      },
    });
    expect(parseFileMock).toHaveBeenCalledWith('/tmp/chapter-one.mp3', { skipCovers: false });
  });

  it('groups tagged albums and sorts tracks while keeping untagged files grouped by folder', async () => {
    jest.spyOn(service, 'parseAudioMetadata').mockImplementation((path) => {
      if (path.includes('tagged')) {
        const trackNumber = path.includes('track-1') ? 1 : 2;
        return Promise.resolve({
          albumTitle: 'Tagged Album',
          albumArtist: 'Tagged Author',
          trackTitle: `Track ${trackNumber}`,
          trackNumber,
          bookMetadata: {},
        });
      }

      const title = path.endsWith('a.mp3') ? 'A' : 'B';
      return Promise.resolve({ trackTitle: title, bookMetadata: {} });
    });

    const groups = await service.previewAudioGroups(
      [
        { path: '/tmp/tagged-track-2.mp3', originalname: 'track-2.mp3' },
        { path: '/tmp/folder/b.mp3', originalname: 'b.mp3' },
        { path: '/tmp/tagged-track-1.mp3', originalname: 'track-1.mp3' },
        { path: '/tmp/folder/a.mp3', originalname: 'a.mp3' },
      ],
      ['collection/track-2.mp3', 'collection/folder/b.mp3', 'other/track-1.mp3', 'collection/folder/a.mp3'],
    );

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      title: 'Tagged Album',
      author: 'Tagged Author',
      source: 'tags',
      tracks: [
        { index: 2, title: 'Track 1' },
        { index: 0, title: 'Track 2' },
      ],
    });
    expect(groups[1]).toMatchObject({
      title: 'folder',
      source: 'folder',
      tracks: [
        { index: 3, title: 'A' },
        { index: 1, title: 'B' },
      ],
    });
  });
});
