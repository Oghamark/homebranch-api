import { JwtService } from '@nestjs/jwt';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import * as request from 'supertest';
import { PasswordRecoveryController } from './password-recovery.controller';
import { MailService } from './mail.service';

describe('PasswordRecoveryController', () => {
  const original = { ...process.env };
  const mail = { isConfigured: jest.fn(), send: jest.fn() };
  let controller: PasswordRecoveryController;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = 'test-secret';
    process.env.AUTH_SERVICE_URL = 'http://auth:3000';
    process.env.PUBLIC_WEB_URL = 'https://library.example.test';
    mail.isConfigured.mockResolvedValue(true);
    mail.send.mockResolvedValue(undefined);
    controller = new PasswordRecoveryController(mail as never, new JwtService());
  });
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('sends a reset link with the token in the URL fragment', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'secret-token' }),
    } as Response);
    await expect(controller.request({ email: 'reader@example.test' })).resolves.toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://auth:3000/password/reset-token',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mail.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'reader@example.test',
        text: expect.stringContaining('https://library.example.test/reset-password#token=secret-token'),
      }),
    );
  });

  it('refuses requests when SMTP is unavailable', async () => {
    mail.isConfigured.mockResolvedValue(false);
    await expect(controller.request({ email: 'reader@example.test' })).rejects.toThrow(
      'Password recovery is not available',
    );
  });

  it('does not expose mail delivery failures to the requester', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({ ok: true, json: () => Promise.resolve({ token: 'secret' }) } as Response);
    mail.send.mockRejectedValue(new Error('SMTP failed'));
    await expect(controller.request({ email: 'reader@example.test' })).resolves.toEqual({ success: true });
  });

  it('validates input and rate-limits the public request route', async () => {
    const module = await Test.createTestingModule({
      imports: [JwtModule.register({}), ThrottlerModule.forRoot([{ ttl: 60000, limit: 5 }])],
      controllers: [PasswordRecoveryController],
      providers: [{ provide: MailService, useValue: mail }],
    }).compile();
    const app: INestApplication = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    await app.init();
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ token: 'secret' }),
    } as Response);
    try {
      await request(app.getHttpServer()).post('/password-recovery').send({ email: 'invalid' }).expect(400);
      for (let i = 0; i < 4; i++) {
        await request(app.getHttpServer())
          .post('/password-recovery')
          .send({ email: 'reader@example.test' })
          .expect(201);
      }
      await request(app.getHttpServer()).post('/password-recovery').send({ email: 'reader@example.test' }).expect(429);
    } finally {
      await app.close();
    }
  });
});
