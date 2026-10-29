import {
  BadRequestException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AccountDirectoryGateway, accessCredential } from './account-directory.gateway';

const id = 'b46b547b-ed12-45eb-a1b5-fc1c036709de';
const account = { id, name: 'Alice' };
const credential = 'verified.access-token.signature';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

describe('AccountDirectoryGateway', () => {
  let gateway: AccountDirectoryGateway;
  let fetchMock: jest.SpiedFunction<typeof fetch>;
  const previousUrl = process.env.AUTH_SERVICE_URL;
  beforeEach(() => {
    gateway = new AccountDirectoryGateway();
    process.env.AUTH_SERVICE_URL = 'http://auth:3000';
    fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(json({ success: true, value: [account] }));
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (previousUrl === undefined) delete process.env.AUTH_SERVICE_URL;
    else process.env.AUTH_SERVICE_URL = previousUrl;
  });

  it.each(['Alice', 'alice@example.com', 'alice@'])(
    'searches %s using only the verified access cookie',
    async (query) => {
      await expect(gateway.search(` ${query} `, credential)).resolves.toEqual([account]);
      const [url, options] = fetchMock.mock.calls[0];
      expect((url as URL).href).toBe(`http://auth:3000/users/social-search?${new URLSearchParams({ query })}`);
      expect(options).toMatchObject({
        method: 'GET',
        headers: { Cookie: `access_token=${credential}`, Accept: 'application/json' },
        redirect: 'error',
      });
      expect(options?.body).toBeUndefined();
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      expect((url as URL).href).not.toContain(credential);
      expect(JSON.stringify(options)).not.toContain('refresh_token');
    },
  );

  it.each(['', 'a', 'x'.repeat(255), 'ab\n', [], undefined])('rejects invalid query %p locally', async (query) => {
    await expect(gateway.search(query as string, credential)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resolves verified existence through bounded names-only lookup', async () => {
    await expect(gateway.requireAccount(id.toUpperCase(), credential)).resolves.toEqual(account);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL('http://auth:3000/users/display-names'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ userIds: [id] }),
      }),
    );
  });

  it('distinguishes verified absence from service outage', async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, value: [] }));
    await expect(gateway.requireAccount(id, credential)).rejects.toBeInstanceOf(NotFoundException);
    fetchMock.mockRejectedValueOnce(new Error(`do not expose ${credential}`));
    await expect(gateway.requireAccount(id, credential)).rejects.toEqual(
      new ServiceUnavailableException('Account directory is unavailable; retry later'),
    );
  });

  it.each([401, 403, 429, 404, 500, 503])('handles upstream status %s explicitly', async (status) => {
    fetchMock.mockResolvedValueOnce(json({ error: 'private upstream message' }, status));
    try {
      await gateway.search('Alice', credential);
      throw new Error('Expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      expect((error as HttpException).getStatus()).toBe([401, 403].includes(status) ? 401 : status === 429 ? 429 : 503);
      expect(String(error)).not.toContain('private upstream message');
    }
  });

  it.each([
    null,
    { success: false, value: [] },
    { success: true, value: {} },
    { success: true, value: [{ id, name: 42 }] },
    { success: true, value: [{ id: 'not-uuid', name: 'Alice' }] },
    { success: true, value: [{ ...account, email: 'private' }] },
    { success: true, value: [{ ...account, name: '' }] },
    { success: true, value: [{ ...account, name: 'x'.repeat(256) }] },
    { success: true, value: [account, account] },
    { success: true, value: Array.from({ length: 21 }, () => account) },
  ])('fails closed on malformed upstream payload %p', async (payload) => {
    fetchMock.mockResolvedValueOnce(json(payload));
    await expect(gateway.search('Alice', credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects unrequested IDs, malformed JSON and oversized responses', async () => {
    fetchMock.mockResolvedValueOnce(
      json({ success: true, value: [{ id: '355c7cc2-cdfc-4029-a471-675d6ef4244d', name: 'Other' }] }),
    );
    await expect(gateway.requireAccount(id, credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    await expect(gateway.search('Alice', credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(json('x'.repeat(70000)));
    await expect(gateway.search('Alice', credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('times out requests without logging the credential or original error', async () => {
    const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
    const realTimeout = AbortSignal.timeout.bind(AbortSignal) as (milliseconds: number) => AbortSignal;
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(10));
    fetchMock.mockImplementationOnce((_url, options) => {
      expect(options?.signal).toBeDefined();
      return new Promise<Response>((_resolve, reject) => {
        options!.signal!.addEventListener('abort', () => reject(new Error(`Timeout ${credential}`)));
      });
    });
    await expect(gateway.search('Alice', credential)).rejects.toThrow('Account directory is unavailable');
    expect(timeout).toHaveBeenCalledWith(5000);
    expect(logger).not.toHaveBeenCalled();
  });

  it.each(['cookie', 'bearer'])(
    'forwards only the guarded %s access token and no other request material',
    async (source) => {
      const request = {
        cookies: {
          ...(source === 'cookie' ? { access_token: credential } : {}),
          refresh_token: 'private-refresh',
          session: 'private-session',
        },
        headers: {
          authorization: `Bearer ${source === 'bearer' ? credential : 'unselected-token'}`,
          'x-private': 'private-header',
        },
      } as unknown as Request;
      await gateway.search('Alice', accessCredential(request));
      expect(fetchMock.mock.calls[0][1]?.headers).toEqual({
        Cookie: `access_token=${credential}`,
        Accept: 'application/json',
      });
    },
  );

  it('batches and deduplicates more than 100 names without inventing missing accounts', async () => {
    const ids = Array.from({ length: 121 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`);
    fetchMock.mockImplementation((_url, options) => {
      const { userIds } = JSON.parse(options!.body as string) as { userIds: string[] };
      return Promise.resolve(json({ success: true, value: userIds.map((id) => ({ id, name: 'Name' })) }));
    });
    await expect(gateway.displayNames([...ids, ids[0]], credential)).resolves.toHaveLength(121);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.map(
        ([, options]) => (JSON.parse(options!.body as string) as { userIds: string[] }).userIds.length,
      ),
    ).toEqual([50, 50, 21]);
  });

  it('never returns partially resolved names when a later chunk fails', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`);
    fetchMock.mockResolvedValueOnce(json({ success: true, value: [{ id: ids[0], name: 'Name' }] }));
    fetchMock.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(gateway.displayNames(ids, credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid ids and excessive batches; empty batches do not dump the directory', async () => {
    await expect(gateway.displayNames([], credential)).resolves.toEqual([]);
    await expect(gateway.requireAccount('not-uuid', credential)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      gateway.displayNames(
        Array.from({ length: 1001 }, () => id),
        credential,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([undefined, 'file:///etc/passwd', 'http://user:password@auth:3000', 'http://auth:3000?secret=foo'])(
    'fails closed for invalid configured service %p',
    async (url) => {
      if (url === undefined) delete process.env.AUTH_SERVICE_URL;
      else process.env.AUTH_SERVICE_URL = url;
      await expect(gateway.search('Alice', credential)).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('never forwards header-injection credentials', async () => {
    await expect(gateway.search('Alice', 'token; refresh_token=secret')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('accessCredential (already guarded requests)', () => {
  it('takes the access cookie first, dropping refresh and unrelated cookies', () => {
    const request = {
      cookies: { access_token: credential, refresh_token: 'private', unrelated: 'private' },
      headers: { authorization: 'Bearer different-token' },
    } as unknown as Request;
    expect(accessCredential(request)).toBe(credential);
  });
  it('normalizes a bearer-only request for cookie-only Authentication', () => {
    expect(accessCredential({ headers: { authorization: `Bearer ${credential}` } } as Request)).toBe(credential);
  });
  it.each([
    { cookies: { refresh_token: 'private' }, headers: {} },
    { cookies: { access_token: 'bad; injected=private' }, headers: { authorization: `Bearer ${credential}` } },
    { headers: { authorization: 'Basic private' } },
  ])('does not fall back to refresh/unverified credentials: %p', (request) => {
    expect(() => accessCredential(request as unknown as Request)).toThrow(UnauthorizedException);
  });
});
