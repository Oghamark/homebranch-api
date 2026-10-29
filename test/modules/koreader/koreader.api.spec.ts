import { Controller, Get, INestApplication, UnauthorizedException, UseGuards } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { KoreaderAuthService } from 'src/modules/koreader/koreader-auth.service';
import { KoreaderDeviceGuard, KoreaderSyncGuard } from 'src/modules/koreader/koreader.guard';
import {
  KoreaderExtensionController,
  KoreaderNativeController,
  KoreaderPairingController,
} from 'src/modules/koreader/koreader.controller';
import { KoreaderDocumentService } from 'src/modules/koreader/koreader-document.service';
import { KoreaderService } from 'src/modules/koreader/koreader.service';

@Controller('general-api')
@UseGuards(JwtAuthGuard)
class GeneralApiController {
  @Get()
  get() {
    return { broadAccess: true };
  }
}

describe('KOReader native and extension HTTP contract', () => {
  const userId = '9c757057-9e29-4f52-9c3a-9d0c63cd5739';
  const deviceId = '9c757057-9e29-4f52-9c3a-9d0c63cd5740';
  const bookId = '9c757057-9e29-4f52-9c3a-9d0c63cd5741';
  const headers = { 'x-auth-user': 'opaque-device', 'x-auth-key': 'device-secret' };
  const document = 'a'.repeat(32);
  let app: INestApplication;
  const auth = {
    authenticate: jest.fn((username, key) => {
      if (username !== headers['x-auth-user'] || key !== headers['x-auth-key']) throw new UnauthorizedException();
      return Promise.resolve({ id: userId, deviceId, roles: [] });
    }),
    assertEntitled: jest.fn(),
    revoke: jest.fn(),
    devices: jest.fn().mockResolvedValue([
      {
        id: deviceId,
        name: 'Reader',
        createdAt: '2026-10-16T00:00:00Z',
        lastSeenAt: null,
        expiresAt: '2027-10-16T00:00:00Z',
      },
    ]),
    createPairing: jest.fn().mockResolvedValue({
      deviceCode: 'polling-secret',
      userCode: 'ABCD123456',
      verificationPath: '/settings?section=koreader&code=ABCD123456',
      expiresIn: 600,
      interval: 5,
    }),
    approve: jest.fn().mockResolvedValue({ state: 'approved' }),
    claim: jest.fn().mockResolvedValue({ state: 'pending' }),
  };
  const service = {
    authenticated: jest.fn().mockResolvedValue({ authorized: 'OK' }),
    putNativeProgress: jest.fn().mockResolvedValue({ document, timestamp: 1792197000 }),
    getNativeProgress: jest.fn().mockResolvedValue({}),
    progress: jest.fn().mockResolvedValue(null),
    annotations: jest.fn().mockResolvedValue({ items: [], cursor: '0', hasMore: false }),
    putAnnotation: jest.fn(),
  };
  const documents = {
    resolve: jest
      .fn()
      .mockResolvedValue({ bookId, formatId: 'format-id', title: 'Fixture', capabilities: { portableLocation: 1 } }),
    locationMap: jest.fn().mockResolvedValue({ version: 1, resources: [], chapters: [] }),
  };
  const jwt = {
    canActivate: (context) => {
      const req = context.switchToHttp().getRequest();
      if (req.headers.authorization !== 'Bearer browser-token') throw new UnauthorizedException();
      req.user = { id: userId, roles: [] };
      return true;
    },
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [
        KoreaderNativeController,
        KoreaderPairingController,
        KoreaderExtensionController,
        GeneralApiController,
      ],
      providers: [
        KoreaderDeviceGuard,
        KoreaderSyncGuard,
        { provide: KoreaderAuthService, useValue: auth },
        { provide: KoreaderService, useValue: service },
        { provide: KoreaderDocumentService, useValue: documents },
        { provide: JwtAuthGuard, useValue: jwt },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(jwt)
      .compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => jest.clearAllMocks());

  test('native health, auth, empty progress and disabled registration have protocol shapes', async () => {
    await request(app.getHttpServer()).get('/koreader/healthcheck').expect(200, { state: 'OK' });
    await request(app.getHttpServer()).get('/koreader/users/auth').set(headers).expect(200, { authorized: 'OK' });
    await request(app.getHttpServer()).get(`/koreader/syncs/progress/${document}`).set(headers).expect(200, {});
    const disabled = await request(app.getHttpServer())
      .post('/koreader/users/create')
      .send({ username: 'u', password: 'not-used' })
      .expect(402);
    expect(disabled.body.code).toBe(2005);
    const unauthenticated = await request(app.getHttpServer()).get('/koreader/users/auth').expect(401);
    expect(unauthenticated.body).toMatchObject({ code: 2001 });
  });

  test('native PUT returns integer seconds and preserves native request fields', async () => {
    const payload = {
      document,
      progress: '/body/p[1]/text().0',
      percentage: 0.42,
      device: 'Reader',
      device_id: 'd1',
      mutationId: 'retry-1',
    };
    const response = await request(app.getHttpServer())
      .put('/koreader/syncs/progress')
      .set(headers)
      .send(payload)
      .expect(200);
    expect(response.body).toEqual({ document, timestamp: 1792197000 });
    expect(service.putNativeProgress).toHaveBeenCalledWith(expect.objectContaining({ id: userId, deviceId }), payload);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  test('serves only exact-format location maps through device-scoped authenticated access', async () => {
    await request(app.getHttpServer())
      .get(`/koreader/books/${bookId}/location-map?formatId=${deviceId}`)
      .set(headers)
      .expect(200, { version: 1, resources: [], chapters: [] });
    expect(documents.locationMap).toHaveBeenCalledWith(
      expect.objectContaining({ id: userId, deviceId }),
      bookId,
      deviceId,
    );
    await request(app.getHttpServer()).get(`/koreader/books/${bookId}/location-map`).set(headers).expect(400);
    await request(app.getHttpServer())
      .get(`/koreader/books/${bookId}/location-map?formatId=bad`)
      .set(headers)
      .expect(400);
    await request(app.getHttpServer()).get(`/koreader/books/${bookId}/location-map?formatId=${deviceId}`).expect(401);
    await request(app.getHttpServer())
      .get(`/koreader/books/${bookId}/location-map?formatId=${deviceId}`)
      .set('Authorization', '******')
      .expect(401);
  });

  test('only scoped extension endpoints accept either browser JWT or device credentials', async () => {
    for (const authHeaders of [headers, { authorization: 'Bearer browser-token' }]) {
      await request(app.getHttpServer()).get(`/koreader/books/${bookId}/progress`).set(authHeaders).expect(200, null);
      await request(app.getHttpServer())
        .get(`/koreader/books/${bookId}/annotations?after=0`)
        .set(authHeaders)
        .expect(200, { items: [], cursor: '0', hasMore: false });
    }
    await request(app.getHttpServer()).get('/general-api').set(headers).expect(401);
    await request(app.getHttpServer()).get('/koreader/devices').set(headers).expect(401);
    await request(app.getHttpServer())
      .post('/koreader/pairings/approve')
      .set(headers)
      .send({ userCode: 'ABCD123456' })
      .expect(401);
    await request(app.getHttpServer())
      .post('/koreader/documents/resolve')
      .set('Authorization', 'Bearer browser-token')
      .send({ document })
      .expect(401);
  });

  test('allows device logout to revoke only itself and never delegates account deletion', async () => {
    await request(app.getHttpServer()).delete(`/koreader/devices/${bookId}`).set(headers).expect(404);
    expect(auth.revoke).not.toHaveBeenCalled();
    await request(app.getHttpServer()).delete(`/koreader/devices/${deviceId}`).set(headers).expect(204);
    expect(auth.revoke).toHaveBeenCalledWith(expect.objectContaining({ id: userId, deviceId }), deviceId);
    await request(app.getHttpServer()).delete('/koreader/users/me').set(headers).expect(200, { deleted: true });
    await request(app.getHttpServer())
      .put('/koreader/users/password')
      .set(headers)
      .send({ password: 'not-used' })
      .expect(403);
  });

  test('pairing is public to initiate and poll but approval requires browser authentication', async () => {
    const pairing = await request(app.getHttpServer())
      .post('/koreader/pairings')
      .send({ deviceName: 'Reader' })
      .expect(200);
    expect(pairing.body.interval).toBe(5);
    expect(pairing.headers['cache-control']).toBe('no-store');
    await request(app.getHttpServer())
      .post('/koreader/pairings/claim')
      .send({ deviceCode: pairing.body.deviceCode })
      .expect(200, { state: 'pending' });
    await request(app.getHttpServer())
      .post('/koreader/pairings/approve')
      .set('Authorization', 'Bearer browser-token')
      .send({ userCode: pairing.body.userCode })
      .expect(200, { state: 'approved' });
  });
});
