import { Readable } from 'stream';
import * as AdmZip from 'adm-zip';
import { PARTIAL_MD5_OFFSETS, partialMd5, partialMd5FromStorage } from 'src/modules/koreader/partial-md5';
import { metadataIndependentIdentity } from 'src/modules/koreader/epub-identity';
import { IStorageService } from 'src/modules/storage/storage.interface';

describe('KOReader binary partial-MD5', () => {
  const bytes = Buffer.from(Array.from({ length: 17000 }, (_, index) => (index * 17) % 251));

  test('uses exact LuaJIT shift offsets, including the initial zero offset', () => {
    expect(PARTIAL_MD5_OFFSETS).toEqual([
      0, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456, 1073741824,
    ]);
    expect(partialMd5(Buffer.alloc(0))).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(partialMd5(Buffer.from('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72');
    // Independent hashlib fixture; 1024 bytes at 0,1024,4096 and the final 616 bytes at 16384.
    expect(partialMd5(bytes)).toBe('ddded2a7835cd7f71fff4e208689baf6');
  });

  test('streams bounded ranges through either storage adapter without loading the book', async () => {
    const getFileStream = jest.fn((_key, range) =>
      Promise.resolve({
        stream: Readable.from([bytes.subarray(range.start, range.end + 1)]),
        contentRange: `bytes ${range.start}-${range.end}/${bytes.length}`,
        size: bytes.length,
      }),
    );
    const storage = { getFileStream } as unknown as IStorageService;
    expect(await partialMd5FromStorage(storage, 'books/book.epub', bytes.length)).toBe(partialMd5(bytes));
    expect(getFileStream).toHaveBeenCalledTimes(4);
    expect(getFileStream.mock.calls.every(([, range]) => range.end - range.start < 1024)).toBe(true);
  });

  test('fails closed when a storage adapter ignores or truncates ranges', async () => {
    const storage = {
      getFileStream: () => Promise.resolve({ stream: Readable.from([bytes]), contentRange: 'wrong' }),
    } as unknown as IStorageService;
    await expect(partialMd5FromStorage(storage, 'book', bytes.length)).rejects.toThrow('byte range');
  });
});

describe('safe metadata-rewrite alias retention', () => {
  function epub(title: string, chapter = '<p>Portable exact quote.</p>', reversed = false) {
    const zip = new AdmZip();
    zip.addFile('mimetype', Buffer.from('application/epub+zip'));
    zip.addFile('META-INF/container.xml', Buffer.from('<container><rootfile full-path="EPUB/book.opf"/></container>'));
    zip.addFile(
      'EPUB/book.opf',
      Buffer.from(
        `<package><metadata><title>${title}</title></metadata><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="${reversed ? 'two' : 'one'}"/><itemref idref="${reversed ? 'one' : 'two'}"/></spine></package>`,
      ),
    );
    zip.addFile('EPUB/one.xhtml', Buffer.from(chapter));
    zip.addFile('EPUB/two.xhtml', Buffer.from('<p>Another chapter.</p>'));
    return zip.toBuffer();
  }

  test('retains a verified alias after metadata-only repacking', () => {
    const original = metadataIndependentIdentity(epub('Original title'));
    expect(original).toMatch(/^[a-f0-9]{64}$/);
    expect(metadataIndependentIdentity(epub('New title'))).toBe(original);
  });

  test('does not retain aliases across changed editions, spine order, or malformed files', () => {
    const original = metadataIndependentIdentity(epub('Original'));
    expect(metadataIndependentIdentity(epub('Original', '<p>Changed edition.</p>'))).not.toBe(original);
    expect(metadataIndependentIdentity(epub('Original', undefined, true))).not.toBe(original);
    expect(metadataIndependentIdentity(Buffer.from('not an epub'))).toBeNull();
  });
});
