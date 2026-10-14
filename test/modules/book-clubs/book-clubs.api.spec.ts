import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

class HeaderUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const httpRequest = context.switchToHttp().getRequest<{
      headers: Record<string, string | undefined>;
      user?: { id: string; email: string; roles: string[] };
    }>();
    const userId = httpRequest.headers['x-test-user'];
    if (typeof userId !== 'string') throw new UnauthorizedException();
    httpRequest.user = { id: userId, email: 'test@example.invalid', roles: [] };
    return true;
  }
}

describe('BookClubsController API', () => {
  const service = {
    listClubs: jest.fn(),
    joinClub: jest.fn(),
    createClub: jest.fn(),
    getClub: jest.fn(),
    updateClub: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    updateMemberRole: jest.fn(),
    archiveClub: jest.fn(),
    transferOwnership: jest.fn(),
    deleteClub: jest.fn(),
  };
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BookClubsController],
      providers: [{ provide: BookClubsService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(HeaderUserGuard)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.listen(0);
    baseUrl = await app.getUrl();
  });

  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => app.close());

  it('creates a club for an authenticated regular user without instance-admin role', async () => {
    service.createClub.mockResolvedValue({ id: 'club-1', ownerUserId: 'reader-1' });

    const response = await fetch(`${baseUrl}/book-clubs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({
        name: 'Evening Readers',
        visibility: 'private',
        selectedWork: { title: 'The Dispossessed', author: 'Ursula K. Le Guin' },
      }),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({ ownerUserId: 'reader-1' }));
    expect(service.createClub).toHaveBeenCalledWith('reader-1', {
      name: 'Evening Readers',
      visibility: 'private',
      selectedWork: { title: 'The Dispossessed', author: 'Ursula K. Le Guin' },
    });
  });

  it('rejects create requests that omit their logical selected work', async () => {
    const response = await fetch(`${baseUrl}/book-clubs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ name: 'No Work', visibility: 'private' }),
    });

    expect(response.status).toBe(400);
    expect(service.createClub).not.toHaveBeenCalled();
  });

  it('routes authenticated instance-local joins to the caller membership', async () => {
    service.joinClub.mockResolvedValue({
      id: 'membership-1',
      clubId: '123e4567-e89b-42d3-a456-426614174002',
      userId: 'reader-2',
      role: 'member',
      createdAt: new Date(0),
    });
    const response = await fetch(`${baseUrl}/book-clubs/123e4567-e89b-42d3-a456-426614174002/join`, {
      method: 'POST',
      headers: { 'x-test-user': 'reader-2' },
    });

    expect(response.status).toBe(201);
    expect(service.joinClub).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174002', 'reader-2');
  });

  it('does not expose the reserved personal-copy association from membership responses', async () => {
    service.joinClub.mockResolvedValue({
      id: 'membership-1',
      clubId: '123e4567-e89b-42d3-a456-426614174002',
      userId: 'reader-2',
      role: 'member',
      personalBookId: 'personal-catalog-book-id',
    });
    const response = await fetch(`${baseUrl}/book-clubs/123e4567-e89b-42d3-a456-426614174002/join`, {
      method: 'POST',
      headers: { 'x-test-user': 'reader-2' },
    });
    const body: unknown = await response.json();

    const bodyKeys = typeof body === 'object' && body !== null ? Object.keys(body) : [];
    expect(response.status).toBe(201);
    expect(bodyKeys).not.toContain('personalBookId');
  });

  it('requires authentication for club endpoints', async () => {
    const response = await fetch(`${baseUrl}/book-clubs`);
    expect(response.status).toBe(401);
  });

  it('rejects malformed UUIDs in every club and target-user route parameter', async () => {
    const validId = '123e4567-e89b-42d3-a456-426614174000';
    const requests: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/book-clubs/not-a-uuid' },
      { method: 'POST', path: '/book-clubs/not-a-uuid/join' },
      { method: 'PATCH', path: '/book-clubs/not-a-uuid', body: { name: 'Updated' } },
      {
        method: 'POST',
        path: '/book-clubs/not-a-uuid/members',
        body: { userId: validId },
      },
      {
        method: 'PATCH',
        path: `/book-clubs/${validId}/members/not-a-uuid`,
        body: { role: 'member' },
      },
      { method: 'DELETE', path: `/book-clubs/${validId}/members/not-a-uuid` },
      {
        method: 'POST',
        path: '/book-clubs/not-a-uuid/transfer-ownership',
        body: { newOwnerUserId: validId },
      },
      { method: 'POST', path: '/book-clubs/not-a-uuid/archive' },
      { method: 'DELETE', path: '/book-clubs/not-a-uuid' },
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          'x-test-user': validId,
          ...(request.body ? { 'content-type': 'application/json' } : {}),
        },
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      expect(response.status).toBe(400);
    }

    expect(service.getClub).not.toHaveBeenCalled();
    expect(service.joinClub).not.toHaveBeenCalled();
    expect(service.updateClub).not.toHaveBeenCalled();
    expect(service.addMember).not.toHaveBeenCalled();
    expect(service.updateMemberRole).not.toHaveBeenCalled();
    expect(service.removeMember).not.toHaveBeenCalled();
    expect(service.transferOwnership).not.toHaveBeenCalled();
    expect(service.archiveClub).not.toHaveBeenCalled();
    expect(service.deleteClub).not.toHaveBeenCalled();
  });

  it('routes club deletion to the service for the authenticated actor', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await fetch(`${baseUrl}/book-clubs/${clubId}`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'owner-1' },
    });

    expect(response.status).toBe(204);
    expect(service.deleteClub).toHaveBeenCalledWith(clubId, 'owner-1');
  });
});
