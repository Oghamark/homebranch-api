import { Repository } from 'typeorm';
import { BookEntity } from 'src/modules/book/book.entity';
import { findGenres } from 'src/modules/book/persistence/book.persistence';

describe('findGenres', () => {
  test('returns distinct, trimmed, sorted genres in the owner scope', async () => {
    const repository = {
      find: jest
        .fn()
        .mockResolvedValueOnce([
          { genres: [' Fantasy ', '', 'Science Fiction'] },
          { genres: ['Fantasy', '  ', 'Biography'] },
        ]),
    } as unknown as Repository<BookEntity>;

    await expect(findGenres(repository, 'user-1')).resolves.toEqual(['Biography', 'Fantasy', 'Science Fiction']);
    expect(repository.find).toHaveBeenCalledWith({
      select: { genres: true },
      where: {
        deletedAt: expect.anything(),
        uploadedByUserId: 'user-1',
      },
    });
  });
});
