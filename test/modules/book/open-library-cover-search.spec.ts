import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { OpenLibraryGateway } from 'src/common/gateways/open-library.gateway';

describe('OpenLibraryGateway cover search', () => {
  const gateway = new OpenLibraryGateway();
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('returns only search results with a usable cover identifier', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          docs: [
            { title: 'Alice in Wonderland', author_name: ['Lewis Carroll'], first_publish_year: 1865, cover_i: 42 },
            { title: 'No Cover' },
            { title: 'Invalid Cover', cover_i: 0 },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );

    await expect(gateway.searchBookCovers('Alice in Wonderland', 'Lewis Carroll')).resolves.toEqual([
      {
        coverId: 42,
        title: 'Alice in Wonderland',
        authors: ['Lewis Carroll'],
        year: 1865,
        thumbnailUrl: 'https://covers.openlibrary.org/b/id/42-M.jpg?default=false',
      },
    ]);
  });

  it('rejects an untrusted redirect while fetching a selected cover', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/cover.jpg' },
      }),
    );

    await expect(gateway.fetchBookCover(42)).rejects.toBeInstanceOf(BadGatewayException);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid cover identifiers before making a network request', async () => {
    await expect(gateway.fetchBookCover(-1)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
