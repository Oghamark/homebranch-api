import { parseFile, parseStream } from 'music-metadata';
import { BookFormatProcessingService } from 'src/modules/book/format/book-format-processing.service';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Readable } from 'stream';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';

jest.mock('music-metadata', () => ({
  parseFile: jest.fn(),
  parseStream: jest.fn(),
}));

describe('BookFormatProcessingService audio metadata', () => {
  const formatRepository = { update: jest.fn() };
  const audioStream = {} as never;
  const storage = {
    getFileStream: jest.fn().mockResolvedValue({ stream: audioStream, mimeType: 'audio/mp4' }),
  };
  const service = new BookFormatProcessingService(
    {} as never,
    formatRepository as never,
    {} as never,
    {} as never,
    storage as never,
  );
  const parseFileMock = jest.mocked(parseFile);
  const parseStreamMock = jest.mocked(parseStream);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not treat a multi-file MP3 audiobook as embedded chapters', async () => {
    await service.updateAudioTracks('book-id', [
      { fileName: 'one.mp3', title: 'Track One' },
      { fileName: 'two.mp3', title: 'Track Two' },
    ]);

    expect(formatRepository.update).toHaveBeenCalledWith(
      { bookId: 'book-id', format: BookFormatType.MP3 },
      {
        audioTracks: [
          { fileName: 'one.mp3', title: 'Track One' },
          { fileName: 'two.mp3', title: 'Track Two' },
        ],
        audioChapters: [],
      },
    );
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
      format: {
        sampleRate: 10,
        chapters: [
          { title: 'Chapter Two', sampleOffset: 200 },
          { title: 'Chapter One', sampleOffset: 0 },
        ],
      },
    } as Awaited<ReturnType<typeof parseFile>>);

    await expect(service.parseAudioMetadata('/tmp/chapter-one.mp3')).resolves.toMatchObject({
      albumTitle: 'The Album',
      albumArtist: 'The Author',
      trackTitle: 'Chapter One',
      chapters: [
        { title: 'Chapter One', startTime: 0 },
        { title: 'Chapter Two', startTime: 20 },
      ],
      bookMetadata: {
        title: 'The Album',
        author: 'The Author',
        publishedYear: 2024,
        genres: ['Fiction'],
        coverImageBuffer: Buffer.from([1, 2, 3]),
        coverImageMimeType: 'image/png',
      },
    });
    expect(parseFileMock).toHaveBeenCalledWith('/tmp/chapter-one.mp3', {
      skipCovers: false,
      includeChapters: true,
    });
  });

  it('returns an empty chapter list when embedded markers are absent', async () => {
    parseFileMock.mockResolvedValue({
      common: {},
      format: { sampleRate: 10 },
    } as Awaited<ReturnType<typeof parseFile>>);

    await expect(service.parseAudioMetadata('/books/no-chapters.mp3')).resolves.toMatchObject({ chapters: [] });
  });

  it('extracts Nero chapter tables for uploads and hydrates stored M4B chapters using byte ranges', async () => {
    const title = Buffer.from('Opening');
    const entry = Buffer.alloc(9);
    entry.writeBigUInt64BE(600_000_000n);
    entry[8] = title.length;
    const header = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 1]);
    const atom = (type: string, payload: Buffer) => {
      const atomHeader = Buffer.alloc(8);
      atomHeader.writeUInt32BE(8 + payload.length);
      atomHeader.write(type, 4);
      return Buffer.concat([atomHeader, payload]);
    };
    const file = atom('moov', atom('udta', atom('chpl', Buffer.concat([header, entry, title]))));
    const directory = await mkdtemp(join(tmpdir(), 'm4b-chapters-'));
    const path = join(directory, 'book.m4b');
    parseFileMock.mockResolvedValue({ common: {}, format: { sampleRate: 44100 } } as Awaited<
      ReturnType<typeof parseFile>
    >);
    parseStreamMock.mockResolvedValue({ common: {}, format: { sampleRate: 44100 } } as Awaited<
      ReturnType<typeof parseStream>
    >);
    try {
      await writeFile(path, file);
      await expect(service.parseAudioMetadata(path)).resolves.toMatchObject({
        chapters: [{ title: 'Opening', startTime: 60 }],
      });
      const storedFormat = Object.assign(new BookFormatEntity(), {
        id: 'format',
        format: BookFormatType.M4B,
        fileName: 'book.m4b',
        title: 'Book',
        author: 'Author',
      });
      const book = Object.assign(new BookEntity(), { id: 'book', formats: [storedFormat] });
      const repository = { save: jest.fn(), update: jest.fn() };
      const getFileStream = jest.fn((_key: string, range?: { start: number; end: number }) =>
        Promise.resolve({
          stream: Readable.from(range ? file.subarray(range.start, range.end + 1) : file),
          mimeType: 'audio/mp4',
          size: file.length,
        }),
      );
      const storedService = new BookFormatProcessingService(
        { findOne: jest.fn().mockResolvedValue(book) } as never,
        repository as never,
        {} as never,
        {} as never,
        { getFileStream } as never,
      );
      await storedService.hydrateStoredFormatMetadata(book);
      expect(storedFormat.audioChapters).toEqual([{ title: 'Opening', startTime: 60 }]);
      expect(repository.save).toHaveBeenCalledWith([storedFormat]);
      expect(getFileStream.mock.calls.some(([, range]) => range !== undefined)).toBe(true);
      getFileStream.mockClear();
      await storedService.hydrateStoredFormatMetadata(book);
      expect(getFileStream).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('parses embedded M4B chapter metadata through the format API', async () => {
    parseStreamMock.mockResolvedValue({
      common: {},
      format: { sampleRate: 10, chapters: [{ title: 'Opening', sampleOffset: 50 }] },
    } as Awaited<ReturnType<typeof parseStream>>);

    await expect(service.parseMetadata('/books/audiobook.m4b', BookFormatType.M4B)).resolves.toMatchObject({
      title: undefined,
    });
    expect(storage.getFileStream).toHaveBeenCalledWith('/books/audiobook.m4b');
    expect(parseStreamMock).toHaveBeenNthCalledWith(
      1,
      audioStream,
      {
        path: '/books/audiobook.m4b',
        mimeType: 'audio/mp4',
      },
      {
        skipCovers: false,
        includeChapters: true,
      },
    );
    await expect(
      service.parseAudioMetadataStream(audioStream, {
        path: 'audiobook.m4b',
        mimeType: 'audio/mp4',
      }),
    ).resolves.toMatchObject({
      chapters: [{ title: 'Opening', startTime: 5 }],
    });
  });

  it('groups tagged albums and sorts tracks while keeping untagged files grouped by folder', async () => {
    jest.spyOn(service, 'parseAudioMetadata').mockImplementation((path) => {
      if (path.includes('tagged')) {
        const trackNumber = path.includes('track-1') ? 1 : 2;
        return Promise.resolve({
          albumTitle: 'Tagged Album',
          albumArtist: 'Tagged Author',
          trackTitle: `Track ${trackNumber}`,
          chapters: [],
          trackNumber,
          bookMetadata: {},
        });
      }

      const title = path.endsWith('a.mp3') ? 'A' : 'B';
      return Promise.resolve({ trackTitle: title, bookMetadata: {}, chapters: [] });
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
