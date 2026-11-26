import * as AdmZip from 'adm-zip';
import { EpubMetadataWriterService } from 'src/modules/book/format/epub-metadata-writer.service';
import { StorageUploadOptions } from 'src/modules/storage/storage.types';

describe('EpubMetadataWriterService', () => {
  test('updates an EPUB using a storage key without a local directory', async () => {
    const epub = new AdmZip();
    epub.addFile(
      'content.opf',
      Buffer.from(
        '<package xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Title</dc:title><dc:creator>Author</dc:creator><dc:description>test</dc:description></metadata></package>',
      ),
    );
    const storage = {
      getFileBuffer: jest.fn().mockResolvedValue({ buffer: epub.toBuffer() }),
      uploadFile: jest.fn<Promise<void>, [Buffer, StorageUploadOptions]>().mockResolvedValue(undefined),
    };
    const writer = new EpubMetadataWriterService(storage as never);

    await writer.writeMetadata('books/no-local-directory/book.epub', {
      title: 'Title',
      author: 'Author',
      summary: 'test2',
    });

    expect(storage.uploadFile).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ key: 'books/no-local-directory/book.epub' }),
    );
    const result = new AdmZip(storage.uploadFile.mock.calls[0][0]);
    expect(result.readAsText('content.opf')).toContain('test2');
  });
});
