import {
  Controller,
  Delete,
  ExecutionContext,
  INestApplication,
  Logger,
  Module,
  Post,
  UnauthorizedException,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Request, Response } from 'express';
import { Server } from 'http';
import { mock } from 'jest-mock-extended';
import * as request from 'supertest';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { DomainExceptionFilter } from 'src/common/filters/domain-exception.filter';
import { AuditLogEntity } from 'src/modules/audit/audit-log.entity';
import { AuditLogModule } from 'src/modules/audit/audit-log.module';
import { AuthModule } from 'src/modules/auth/auth.module';
import { AuditLogMiddleware, buildAuditRecord } from 'src/modules/audit/audit-log.middleware';
import { AuditLogQueryDto } from 'src/modules/audit/audit-log-query.dto';
import { AuditLogService } from 'src/modules/audit/audit-log.service';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const BOOK_ID = '22222222-2222-4222-8222-222222222222';
const FORMAT_ID = '33333333-3333-4333-8333-333333333333';

@Controller('books')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
class ActionController {
  @Delete(':id/formats/:formatId/file')
  remove() {
    return { deleted: true };
  }

  @Post()
  create() {
    return { id: BOOK_ID };
  }

  @Post('failed-action')
  failedAction() {
    return { success: false, message: 'Do not store this response body' };
  }
}

@Module({ providers: [RolesGuard], exports: [RolesGuard] })
class TestAuthModule {}

describe('audit logging HTTP integration', () => {
  let app: INestApplication;
  let server: Server;
  const logs = { record: jest.fn().mockResolvedValue(undefined), find: jest.fn() };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AuditLogModule],
      controllers: [ActionController],
      providers: [RolesGuard],
    })
      .overrideModule(AuthModule)
      .useModule(TestAuthModule)
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({})
      .overrideProvider(AuditLogService)
      .useValue(logs)
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const req = context.switchToHttp().getRequest<Request>();
          const role = req.headers['x-test-role'];
          if (!role) throw new UnauthorizedException();
          req.user = { id: USER_ID, email: 'reader@example.test', roles: [String(role)] };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    server = app.getHttpServer() as Server;
  });

  beforeEach(() => {
    logs.record.mockClear();
    logs.find.mockReset().mockResolvedValue({ data: [], total: 0, limit: 25, offset: 0 });
  });
  afterAll(async () => app.close());

  it('attributes format deletion and stores only route IDs, never secrets or raw URLs', async () => {
    await request(server)
      .delete(`/books/${BOOK_ID}/formats/${FORMAT_ID}/file?token=secret`)
      .set('x-test-role', 'ADMIN')
      .set('Authorization', 'Bearer secret')
      .send({ password: 'secret', requestingUserId: 'forged' })
      .expect(200);
    expect(logs.record).toHaveBeenCalledWith({
      actorId: USER_ID,
      actorLabel: 'reader@example.test',
      method: 'DELETE',
      route: '/books/:id/formats/:formatId/file',
      resourceIds: { id: BOOK_ID, formatId: FORMAT_ID },
      statusCode: 200,
      outcome: 'success',
    });
  });

  it('captures authorization failures using the verified actor and anonymous authentication failures', async () => {
    await request(server).post('/books').set('x-test-role', 'USER').expect(403);
    expect(logs.record).toHaveBeenLastCalledWith(expect.objectContaining({ actorId: USER_ID, statusCode: 403 }));
    await request(server).post('/books').send({ email: 'forged@example.test' }).expect(401);
    expect(logs.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorId: null, actorLabel: null, statusCode: 401 }),
    );
  });

  it('restricts audit queries to administrators and validates pagination and dates', async () => {
    await request(server).get('/audit-logs').expect(401);
    await request(server).get('/audit-logs').set('x-test-role', 'USER').expect(403);
    expect(logs.find).not.toHaveBeenCalled();
    await request(server).get('/audit-logs?limit=0&offset=-1').set('x-test-role', 'ADMIN').expect(400);
    await request(server).get('/audit-logs?from=invalid').set('x-test-role', 'ADMIN').expect(400);
    await request(server).get('/audit-logs?limit=10&offset=20').set('x-test-role', 'ADMIN').expect(200);
    expect(logs.find).toHaveBeenCalledWith(expect.objectContaining({ limit: 10, offset: 20 }));
    expect(logs.record).not.toHaveBeenCalled();
  });

  it('records business failures without changing HTTP status or storing the response body', async () => {
    await request(server).post('/books/failed-action').set('x-test-role', 'ADMIN').expect(201);
    expect(logs.record).toHaveBeenCalledWith({
      actorId: USER_ID,
      actorLabel: 'reader@example.test',
      method: 'POST',
      route: '/books/failed-action',
      resourceIds: {},
      statusCode: 201,
      outcome: 'failure',
    });
  });
});

describe('audit record selection', () => {
  function record(route: string, method: string, params = {}) {
    return buildAuditRecord({ route: { path: route }, method, params, headers: {} } as Request, 200);
  }

  it('excludes routine reads, unknown routes, previews and automatic reading progress', () => {
    expect(record('/books/:id', 'GET')).toBeUndefined();
    expect(buildAuditRecord({ method: 'POST' } as Request, 404)).toBeUndefined();
    expect(record('/books/audiobook/preview', 'POST')).toBeUndefined();
    expect(record('/users/:userId/saved-positions/:bookId', 'PUT')).toBeUndefined();
    expect(record('/koreader/syncs/progress', 'PUT')).toBeUndefined();
    expect(record('/books/:id/download', 'GET')).toBeDefined();
    expect(record('/koreader/devices/:id', 'DELETE')).toBeDefined();
  });

  it('retains only UUID resource IDs and supports device-authenticated users', () => {
    const req = {
      route: { path: '/koreader/books/:bookId/annotations/:id' },
      method: 'PUT',
      params: { bookId: BOOK_ID, id: 'secret-token', email: 'private@example.test' },
      headers: {},
      syncActor: { id: USER_ID, email: 'reader@example.test' },
    };
    expect(buildAuditRecord(req, 200)).toEqual(
      expect.objectContaining({
        actorId: USER_ID,
        resourceIds: { bookId: BOOK_ID },
      }),
    );
  });

  it('reports persistence failures without leaking the rejected database error', async () => {
    const service = mock<AuditLogService>();
    service.record.mockRejectedValue(new Error('password=secret'));
    const logger = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const response = mock<Response>();
    response.statusCode = 200;
    let finish: (() => void) | undefined;
    response.once.mockImplementation((event, listener) => {
      if (event === 'finish')
        finish = () => {
          listener();
        };
      return response;
    });
    const middleware = new AuditLogMiddleware(service);
    middleware.use(
      { route: { path: '/books' }, method: 'POST', params: {}, headers: {} } as Request,
      response,
      jest.fn(),
    );
    finish?.();
    await Promise.resolve();
    expect(logger).toHaveBeenCalledWith('Failed to persist an audit log entry');
    logger.mockRestore();
  });
});

describe('audit filters', () => {
  const repository = mock<Repository<AuditLogEntity>>();
  const qb = mock<SelectQueryBuilder<AuditLogEntity>>();
  const service = new AuditLogService(repository);

  beforeEach(() => {
    repository.createQueryBuilder.mockReturnValue(qb);
    qb.andWhere.mockReset().mockReturnThis();
    qb.orderBy.mockReturnThis();
    qb.addOrderBy.mockReturnThis();
    qb.take.mockReturnThis();
    qb.skip.mockReturnThis();
    qb.getManyAndCount.mockResolvedValue([[], 42]);
  });

  it('applies literal actor/action, outcome and date filters with bounded stable pagination', async () => {
    const query = plainToInstance(AuditLogQueryDto, {
      actor: 'reader_100%',
      action: 'DELETE',
      outcome: 'failure',
      from: '2026-11-01T00:00:00Z',
      to: '2026-11-27T23:59:59Z',
      limit: '10',
      offset: '20',
    });
    expect(await validate(query)).toEqual([]);
    expect(await service.find(query)).toEqual({ data: [], total: 42, limit: 10, offset: 20 });
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('actorLabel'), { actor: '%reader\\_100\\%%' });
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('CONCAT'), { action: '%DELETE%' });
    expect(qb.andWhere).toHaveBeenCalledWith('log.outcome = :outcome', { outcome: 'failure' });
    expect(qb.andWhere).toHaveBeenCalledWith('log.createdAt >= :from', { from: new Date(query.from!) });
    expect(qb.orderBy).toHaveBeenCalledWith('log.createdAt', 'DESC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('log.id', 'DESC');
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(qb.skip).toHaveBeenCalledWith(20);
  });

  it('rejects reversed ranges and excessive or malformed pagination', async () => {
    await expect(
      service.find(
        plainToInstance(AuditLogQueryDto, {
          from: '2026-12-01T00:00:00Z',
          to: '2026-11-01T00:00:00Z',
        }),
      ),
    ).rejects.toThrow('The start date must not be after the end date');
    expect(
      await validate(plainToInstance(AuditLogQueryDto, { limit: '101', offset: '-1', outcome: 'unknown' })),
    ).toHaveLength(3);
  });
});
