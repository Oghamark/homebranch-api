import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetBooksRequest } from 'src/modules/book/dto/get-books-request';

describe('GetBooksRequest', () => {
  test('transforms year bounds and accepts supported sort values', async () => {
    const request = plainToInstance(GetBooksRequest, {
      yearFrom: '1980',
      yearTo: '1990',
      sortBy: 'publishedYear',
      sortDirection: 'DESC',
      genreFilter: 'Fantasy',
    });

    expect(request.yearFrom).toBe(1980);
    expect(request.yearTo).toBe(1990);
    await expect(validate(request)).resolves.toHaveLength(0);
  });

  test('rejects invalid sort keys and non-integer year bounds', async () => {
    const request = plainToInstance(GetBooksRequest, {
      sortBy: 'fileName',
      sortDirection: 'SIDEWAYS',
      yearFrom: 'not-a-year',
    });

    const errors = await validate(request);
    expect(errors.map(({ property }) => property)).toEqual(
      expect.arrayContaining(['sortBy', 'sortDirection', 'yearFrom']),
    );
  });
});
