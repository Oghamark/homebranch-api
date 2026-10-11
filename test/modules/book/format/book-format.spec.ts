import {
  detectBookFormatFromFileName,
  getBookFormatMediaType,
  getSupportedBookFormatDefinitions,
  isSupportedBookFile,
} from 'src/modules/book/format/book-format';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';

describe('book formats', () => {
  it.each([
    ['novel.epub', BookFormatType.EPUB],
    ['manual.PDF', BookFormatType.PDF],
    ['story.mp3', BookFormatType.MP3],
    ['story.M4B', BookFormatType.M4B],
  ])('detects %s as %s', (fileName, format) => {
    expect(detectBookFormatFromFileName(fileName)).toBe(format);
    expect(isSupportedBookFile(fileName)).toBe(true);
  });

  it('assigns playable audio media types without EPUB processing features', () => {
    const formats = getSupportedBookFormatDefinitions();
    const mp3 = formats.find((definition) => definition.format === BookFormatType.MP3);
    const m4b = formats.find((definition) => definition.format === BookFormatType.M4B);

    expect(getBookFormatMediaType(BookFormatType.MP3)).toBe('audio/mpeg');
    expect(getBookFormatMediaType(BookFormatType.M4B)).toBe('audio/mp4');
    expect(mp3).toMatchObject({ supportsManifest: false, supportsContentEntries: false });
    expect(m4b).toMatchObject({ supportsManifest: false, supportsContentEntries: false });
  });
});
