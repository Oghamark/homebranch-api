import { KoreaderAuthService, verifier } from 'src/modules/koreader/koreader-auth.service';

describe('KOReader device access and deployment restrictions', () => {
  const id = '9c757057-9e29-4f52-9c3a-9d0c63cd5739';
  const deviceId = '9c757057-9e29-4f52-9c3a-9d0c63cd5740';
  const key = 'a'.repeat(43);
  const username = `hb_${'b'.repeat(36)}`;
  const db = { query: jest.fn() };
  const entitlements = { cloudMode: true, getState: jest.fn() };
  let auth: KoreaderAuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    auth = new KoreaderAuthService(db as never, entitlements as never);
  });

  test('rejects malformed native credentials before a database lookup', async () => {
    await expect(auth.authenticate('email@example.test', 'password-md5')).rejects.toMatchObject({ status: 401 });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('returns only scoped ownership after matching a device verifier', async () => {
    db.query.mockResolvedValue([{ id: deviceId, user_id: id, verifier: verifier(key) }]);
    expect(await auth.authenticate(username, key)).toEqual({ id, deviceId, roles: [] });
    await expect(auth.authenticate(username, 'x'.repeat(43))).rejects.toMatchObject({ status: 401 });
    db.query.mockResolvedValue([]);
    await expect(auth.authenticate(username, key)).rejects.toMatchObject({ status: 401 });
  });

  test('cloud device access does not inherit admin bypass and respects read-only state', async () => {
    const actor = { id, deviceId, roles: ['ADMIN'] };
    entitlements.getState.mockResolvedValue('blocked');
    await expect(auth.assertEntitled(actor, false)).rejects.toMatchObject({ status: 403 });
    entitlements.getState.mockResolvedValue('read_only');
    await expect(auth.assertEntitled(actor, false)).resolves.toBeUndefined();
    await expect(auth.assertEntitled(actor, true)).rejects.toMatchObject({ status: 403 });
    entitlements.getState.mockResolvedValue('active');
    await expect(auth.assertEntitled(actor, true)).resolves.toBeUndefined();
  });

  test('production requires an HTTPS public API URL', () => {
    const oldNode = process.env.NODE_ENV;
    const oldUrl = process.env.APP_URL;
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.APP_URL;
      expect(() => auth.onModuleInit()).toThrow('HTTPS');
      process.env.APP_URL = 'http://localhost:3000';
      expect(() => auth.onModuleInit()).toThrow('HTTPS');
      process.env.APP_URL = 'https://api.homebranch.test';
      expect(() => auth.onModuleInit()).not.toThrow();
    } finally {
      if (oldNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = oldNode;
      if (oldUrl === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = oldUrl;
    }
  });
});
