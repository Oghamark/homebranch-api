import { BookMutationService } from 'src/modules/book/catalog/book-mutation.service';
import { Book } from 'src/modules/book/book.model';
import { BookFormatEntity } from 'src/modules/book/format/book-format.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { BookPersistenceService } from 'src/modules/book/persistence/book.persistence';
import { mockBook } from 'test/mocks/bookMocks';

describe('BookMutationService', () => {
  let service: BookMutationService;
  let bookPersistenceService: jest.Mocked<BookPersistenceService>;
  let fileProcessingQueue: { enqueueMetadataSync: jest.Mock };
  let storage: { uploadFile: jest.Mock };
  let bookFormatProcessingService: { parseMetadata: jest.Mock };

  beforeEach(() => {
    process.env.UPLOADS_DIRECTORY = 'C:\\library';
    bookPersistenceService = {
      findBookById: jest.fn(),
      updateBookRecord: jest.fn(),
      permanentDeleteBook: jest.fn(),
      splitBookFormatRecord: jest.fn(),
    } as unknown as jest.Mocked<BookPersistenceService>;
    fileProcessingQueue = { enqueueMetadataSync: jest.fn() };
    storage = { uploadFile: jest.fn() };
    bookFormatProcessingService = { parseMetadata: jest.fn() };

    service = new BookMutationService(
      bookPersistenceService,
      fileProcessingQueue as never,
      bookFormatProcessingService as never,
      storage as never,
    );
  });

  afterEach(() => {
    delete process.env.UPLOADS_DIRECTORY;
    jest.clearAllMocks();
  });

  test('updates a book and enqueues metadata sync', async () => {
    const updatedBook = { ...mockBook, title: 'Updated Title' };
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    bookPersistenceService.updateBookRecord.mockResolvedValueOnce(updatedBook);

    await expect(service.updateBook({ id: mockBook.id, title: 'Updated Title' })).resolves.toEqual(updatedBook);
    expect(fileProcessingQueue.enqueueMetadataSync).toHaveBeenCalledWith(
      mockBook.id,
      updatedBook.fileName,
      `books/${updatedBook.fileName}`,
      { preferredDbFields: ['title'] },
    );
  });

  test('enqueues metadata sync for every linked format', async () => {
    const epub = Object.assign(new BookFormatEntity(), {
      id: 'epub',
      format: BookFormatType.EPUB,
      fileName: 'orchard.epub',
    });
    const pdf = Object.assign(new BookFormatEntity(), {
      id: 'pdf',
      format: BookFormatType.PDF,
      fileName: 'orchard.pdf',
    });
    const updatedBook = { ...mockBook, title: 'Updated Title', formats: [epub, pdf] };
    bookPersistenceService.findBookById.mockResolvedValueOnce(mockBook);
    bookPersistenceService.updateBookRecord.mockResolvedValueOnce(updatedBook);

    await service.updateBook({ id: mockBook.id, title: 'Updated Title' });

    expect(fileProcessingQueue.enqueueMetadataSync).toHaveBeenCalledWith(
      mockBook.id,
      'orchard.epub',
      'books/orchard.epub',
      { preferredDbFields: ['title'] },
    );
    expect(fileProcessingQueue.enqueueMetadataSync).toHaveBeenCalledWith(
      mockBook.id,
      'orchard.pdf',
      'books/orchard.pdf',
      { preferredDbFields: ['title'] },
    );
  });

  test('updates supplied metadata on each format and preserves the previous sync baseline', async () => {
    const existing = new Book('book', 'Title', 'Author', 'book.epub', false, []);
    existing.summary = 'test';
    existing.formats = [
      Object.assign(new BookFormatEntity(), {
        id: 'epub',
        fileName: 'book.epub',
        summary: 'test',
        title: 'Ebook title',
      }),
      Object.assign(new BookFormatEntity(), {
        id: 'audio',
        fileName: 'book.mp3',
        summary: 'old',
        title: 'Audio title',
      }),
    ];
    bookPersistenceService.findBookById.mockResolvedValueOnce(existing);
    bookPersistenceService.updateBookRecord.mockImplementation((_id, book) => Promise.resolve(book));

    const updated = await service.updateBook({ id: existing.id, summary: 'test2' });

    expect(updated.summary).toBe('test2');
    expect(updated.formats).toEqual([
      expect.objectContaining({ summary: 'test2', title: 'Ebook title' }),
      expect.objectContaining({ summary: 'test2', title: 'Audio title' }),
    ]);
    expect(updated.syncedMetadata).toEqual(expect.objectContaining({ summary: 'test' }));
    expect(existing.formats[0].summary).toBe('test');
    expect(fileProcessingQueue.enqueueMetadataSync).toHaveBeenCalledWith('book', 'book.mp3', 'books/book.mp3', {
      preferredDbFields: ['summary'],
    });
  });

  test('links two books by merging formats and deleting the source', async () => {
    const target = new Book('target', 'Shared', 'Author', 'shared.epub', false, []);
    target.uploadedByUserId = 'user-123';
    target.formats = [
      Object.assign(new BookFormatEntity(), { id: 'epub', format: BookFormatType.EPUB, fileName: 'shared.epub' }),
    ];

    const source = new Book('source', 'Shared', 'Author', 'shared.pdf', false, []);
    source.uploadedByUserId = 'user-123';
    source.formats = [
      Object.assign(new BookFormatEntity(), { id: 'pdf', format: BookFormatType.PDF, fileName: 'shared.pdf' }),
    ];

    bookPersistenceService.findBookById.mockResolvedValueOnce(target).mockResolvedValueOnce(source);
    bookPersistenceService.updateBookRecord.mockImplementation((_id, book) => Promise.resolve(book));
    bookPersistenceService.permanentDeleteBook.mockResolvedValueOnce(source);

    const result = await service.linkBooks({
      targetBookId: 'target',
      sourceBookId: 'source',
      requestingUserId: 'user-123',
      requestingUserRole: 'USER',
    });

    expect(result.formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ format: BookFormatType.EPUB }),
        expect.objectContaining({ format: BookFormatType.PDF }),
      ]),
    );
    expect(bookPersistenceService.permanentDeleteBook).toHaveBeenCalledWith('source');
  });

  test('unlinks a format into a split book', async () => {
    const linkedBook = new Book('book-1', 'Merged Title', 'Merged Author', 'linked.epub', true, ['Fantasy']);
    linkedBook.uploadedByUserId = 'user-123';
    linkedBook.formats = [
      Object.assign(new BookFormatEntity(), {
        id: 'format-epub',
        format: BookFormatType.EPUB,
        fileName: 'Linked.epub',
      }),
      Object.assign(new BookFormatEntity(), { id: 'format-pdf', format: BookFormatType.PDF, fileName: 'Original.pdf' }),
    ];

    bookPersistenceService.findBookById.mockResolvedValueOnce(linkedBook);
    bookPersistenceService.splitBookFormatRecord.mockImplementation((_id, updatedBook) => Promise.resolve(updatedBook));
    bookFormatProcessingService.parseMetadata.mockResolvedValueOnce({
      title: 'Original Title',
      author: 'Original Author',
      coverImageBuffer: Buffer.from('cover'),
    });
    storage.uploadFile.mockResolvedValueOnce(undefined);

    await expect(
      service.unlinkBookFormat({
        bookId: linkedBook.id,
        formatId: 'format-pdf',
        requestingUserId: 'user-123',
        requestingUserRole: 'USER',
      }),
    ).resolves.toEqual(expect.objectContaining({ fileName: 'Linked.epub' }));
    expect(bookPersistenceService.splitBookFormatRecord).toHaveBeenCalledTimes(1);
    expect(bookFormatProcessingService.parseMetadata).toHaveBeenCalledWith('books/Original.pdf', BookFormatType.PDF);
    expect(bookFormatProcessingService.parseMetadata).toHaveBeenCalledWith('books/Original.pdf', BookFormatType.PDF);
    const [, uploadOptions] = storage.uploadFile.mock.calls[0] as [Buffer, { key: string; mimeType: string }];
    expect(uploadOptions.key).toMatch(/^cover-images[\\/].+\.jpg$/);
    expect(uploadOptions.mimeType).toBe('image/jpeg');
  });
});
