import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BookEntity } from 'src/modules/book/book.entity';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { deleteBookFormat } from 'src/modules/book/persistence/book.persistence';

describe('deleteBookFormat', () => {
  const epub = { id: 'epub', bookId: 'book', format: BookFormatType.EPUB, fileName: 'book.epub' };
  const audio = {
    id: 'audio',
    bookId: 'book',
    format: BookFormatType.MP3,
    fileName: 'first.mp3',
    audioTracks: [
      { fileName: 'first.mp3', title: 'First' },
      { fileName: 'shared.mp3', title: 'Shared' },
      { fileName: 'last.mp3', title: 'Last' },
    ],
  };
  let book: any;
  let books: any;
  let formats: any;
  let storage: any;

  beforeEach(() => {
    book = { id: 'book', uploadedByUserId: 'owner', fileName: 'first.mp3', coverImageFileName: 'cover.jpg' };
    books = { findOne: jest.fn().mockResolvedValue(book), save: jest.fn(), exists: jest.fn().mockResolvedValue(false) };
    const query = {
      where: jest.fn().mockReturnThis(),
      getExists: jest.fn().mockImplementation(() => {
        const [, params] = query.where.mock.lastCall;
        return Promise.resolve(params.fileName === 'shared.mp3');
      }),
    };
    formats = {
      find: jest.fn().mockResolvedValue([epub, audio]),
      delete: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(query),
    };
    books.manager = {
      // The transaction mock dispatches the two repositories by entity.
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      transaction: (callback: any) =>
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        callback({ getRepository: (entity: any) => (entity === BookEntity ? books : formats) }),
    };
    storage = { deleteFile: jest.fn() };
  });

  it('removes only the requested format and unreferenced files, retaining the book and cover', async () => {
    const result = await deleteBookFormat(books, formats, storage, 'book', 'audio', 'owner', false);
    expect(result).toEqual(
      expect.objectContaining({
        fileName: 'book.epub',
        coverImageFileName: 'cover.jpg',
        formats: [expect.objectContaining({ id: 'epub', fileName: 'book.epub' })],
      }),
    );
    expect(formats.delete).toHaveBeenCalledWith({ id: 'audio', bookId: 'book' });
    expect(storage.deleteFile.mock.calls).toEqual([['books/first.mp3'], ['books/last.mp3']]);
    expect(books.findOne).toHaveBeenCalledWith(expect.objectContaining({ lock: { mode: 'pessimistic_write' } }));
  });

  it('does not remove files referenced by legacy book records', async () => {
    books.exists.mockResolvedValue(true);
    await deleteBookFormat(books, formats, storage, 'book', 'audio', 'owner', false);
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects deleting the last format', async () => {
    formats.find.mockResolvedValue([epub]);
    await expect(deleteBookFormat(books, formats, storage, 'book', 'epub', 'owner', false)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(formats.delete).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('rejects a format from another book and denies non-owners', async () => {
    await expect(deleteBookFormat(books, formats, storage, 'book', 'elsewhere', 'owner', false)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(formats.find).toHaveBeenCalledWith({ where: { bookId: 'book' } });
    await expect(deleteBookFormat(books, formats, storage, 'book', 'audio', 'stranger', false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(formats.delete).not.toHaveBeenCalled();
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  it('allows admins to manage formats', async () => {
    await expect(deleteBookFormat(books, formats, storage, 'book', 'audio', 'admin', true)).resolves.toBeDefined();
  });
});
