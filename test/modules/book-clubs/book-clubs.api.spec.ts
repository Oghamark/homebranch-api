import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubDiscussionService } from 'src/modules/book-clubs/book-club-discussion.service';

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
    getSchedule: jest.fn(),
    updateClub: jest.fn(),
    addMember: jest.fn(),
    removeMember: jest.fn(),
    updateMemberRole: jest.fn(),
    archiveClub: jest.fn(),
    transferOwnership: jest.fn(),
    deleteClub: jest.fn(),
    getReadingCopy: jest.fn(),
    getWorkMatchCandidates: jest.fn(),
    confirmWorkMatch: jest.fn(),
    setReadingCopy: jest.fn(),
    clearReadingCopy: jest.fn(),
    updateSchedule: jest.fn(),
    setMilestoneProgress: jest.fn(),
    setMilestoneMapping: jest.fn(),
    setProgressSharing: jest.fn(),
  };
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [BookClubsController],
      providers: [
        { provide: BookClubsService, useValue: service },
        { provide: BookClubDiscussionService, useValue: {} },
      ],
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
        selectedWork: {
          title: 'The Dispossessed',
          author: 'Ursula K. Le Guin',
          isbn: '9780061054884',
          externalWorkId: 'openlibrary-work-123',
          editionId: 'edition-456',
        },
      }),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual(expect.objectContaining({ ownerUserId: 'reader-1' }));
    expect(service.createClub).toHaveBeenCalledWith('reader-1', {
      name: 'Evening Readers',
      visibility: 'private',
      selectedWork: {
        title: 'The Dispossessed',
        author: 'Ursula K. Le Guin',
        isbn: '9780061054884',
        externalWorkId: 'openlibrary-work-123',
        editionId: 'edition-456',
      },
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

  it('returns the caller-specific membership role from a club read', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174002';
    service.getClub.mockResolvedValue({ id: clubId, currentMembershipRole: 'moderator' });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}`, {
      headers: { 'x-test-user': 'moderator-1' },
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({ currentMembershipRole: 'moderator' }));
    expect(service.getClub).toHaveBeenCalledWith(clubId, 'moderator-1');
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

  it('routes a member personal-copy choice for the specified logical work', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    const bookId = '123e4567-e89b-42d3-a456-426614174003';
    service.setReadingCopy.mockResolvedValue({
      clubId,
      workId,
      source: 'personal',
      available: true,
      book: { id: bookId, title: 'Personal book', author: 'Author' },
    });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ source: 'personal', bookId }),
    });
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      clubId,
      workId,
      source: 'personal',
      available: true,
      book: { id: bookId, title: 'Personal book', author: 'Author' },
    });
    expect(service.setReadingCopy).toHaveBeenCalledWith(clubId, workId, 'reader-1', { source: 'personal', bookId });
  });

  it('routes a member reading-copy state read for the requested logical work', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    service.getReadingCopy.mockResolvedValue({
      clubId,
      workId,
      source: 'none',
      available: false,
      book: null,
    });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy`, {
      headers: { 'x-test-user': 'reader-1' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ clubId, workId, source: 'none', available: false, book: null });
    expect(service.getReadingCopy).toHaveBeenCalledWith(clubId, workId, 'reader-1');
  });

  it('routes schedule updates to the authenticated owner or moderator without accepting actor IDs', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const schedule = {
      startDate: '2026-11-01',
      completionDate: '2026-12-01',
      milestones: [{ name: 'Part One', kind: 'part', position: 1 }],
    };
    service.updateSchedule.mockResolvedValue(schedule);

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'club-moderator' },
      body: JSON.stringify(schedule),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(schedule);
    expect(service.updateSchedule).toHaveBeenCalledWith(clubId, 'club-moderator', schedule);
  });

  it('rejects null milestones while allowing an empty milestone list', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    service.updateSchedule.mockResolvedValue({ clubId, startDate: null, completionDate: null, milestones: [] });

    const nullResponse = await fetch(`${baseUrl}/book-clubs/${clubId}/schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'club-moderator' },
      body: JSON.stringify({ milestones: null }),
    });
    const emptyResponse = await fetch(`${baseUrl}/book-clubs/${clubId}/schedule`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'club-moderator' },
      body: JSON.stringify({ milestones: [] }),
    });

    expect(nullResponse.status).toBe(400);
    expect(emptyResponse.status).toBe(200);
    expect(service.updateSchedule).toHaveBeenCalledTimes(1);
    expect(service.updateSchedule).toHaveBeenCalledWith(clubId, 'club-moderator', { milestones: [] });
  });

  it('routes member progress as a coarse summary and does not accept reading locations', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const milestoneId = '123e4567-e89b-42d3-a456-426614174002';
    const progress = { status: 'in_progress', percentage: 42 };
    service.setMilestoneProgress.mockResolvedValue({ milestoneId, ...progress });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/milestones/${milestoneId}/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify(progress),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ milestoneId, ...progress });
    expect(service.setMilestoneProgress).toHaveBeenCalledWith(clubId, milestoneId, 'reader-1', progress);

    const locationAttempt = await fetch(`${baseUrl}/book-clubs/${clubId}/milestones/${milestoneId}/progress`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ ...progress, cfi: 'epubcfi(/6/4)' }),
    });
    expect(locationAttempt.status).toBe(400);
    expect(service.setMilestoneProgress).toHaveBeenCalledTimes(1);
  });

  it('routes schedule reads through the authenticated member context', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const schedule = {
      clubId,
      startDate: '2026-11-01',
      completionDate: '2026-12-01',
      milestones: [{ id: 'milestone-1', name: 'Part One', kind: 'part', position: 1 }],
      progressSharingEnabled: false,
      myMappings: [],
      myProgress: [],
      sharedProgress: [],
    };
    service.getSchedule.mockResolvedValue(schedule);

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/schedule`, {
      headers: { 'x-test-user': 'reader-1' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(schedule);
    expect(service.getSchedule).toHaveBeenCalledWith(clubId, 'reader-1');
  });

  it('lets a member explicitly opt into coarse progress sharing', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    service.setProgressSharing.mockResolvedValue({ enabled: true });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/progress-sharing`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true });
    expect(service.setProgressSharing).toHaveBeenCalledWith(clubId, 'reader-1', true);
  });

  it('stores member-specific milestone mappings without accepting reader locations', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const milestoneId = '123e4567-e89b-42d3-a456-426614174002';
    const mapping = { memberLabel: 'My Chapter 7', memberPosition: 7 };
    service.setMilestoneMapping.mockResolvedValue({ milestoneId, ...mapping });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/milestones/${milestoneId}/mapping`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify(mapping),
    });
    const locationAttempt = await fetch(`${baseUrl}/book-clubs/${clubId}/milestones/${milestoneId}/mapping`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ ...mapping, pageNumber: 42 }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ milestoneId, ...mapping });
    expect(locationAttempt.status).toBe(400);
    expect(service.setMilestoneMapping).toHaveBeenCalledTimes(1);
    expect(service.setMilestoneMapping).toHaveBeenCalledWith(clubId, milestoneId, 'reader-1', mapping);
  });

  it('routes candidate discovery to the authenticated member without accepting a caller-supplied actor ID', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    service.getWorkMatchCandidates.mockResolvedValue([
      {
        bookId: '123e4567-e89b-42d3-a456-426614174003',
        title: 'Personal edition',
        author: 'Author',
        method: 'identifier',
        confidence: 1,
        confirmationRequired: true,
      },
    ]);

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy/matches`, {
      headers: { 'x-test-user': 'reader-1' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        bookId: '123e4567-e89b-42d3-a456-426614174003',
        title: 'Personal edition',
        author: 'Author',
        method: 'identifier',
        confidence: 1,
        confirmationRequired: true,
      },
    ]);
    expect(service.getWorkMatchCandidates).toHaveBeenCalledWith(clubId, workId, 'reader-1');
  });

  it('requires a member action to confirm a suggested match', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    const bookId = '123e4567-e89b-42d3-a456-426614174003';
    service.confirmWorkMatch.mockResolvedValue({
      clubId,
      workId,
      source: 'personal',
      available: true,
      book: { id: bookId, title: 'Translated edition', author: 'Author' },
      associationMethod: 'identifier',
      confidence: 1,
    });

    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy/matches/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ bookId }),
    });

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      associationMethod: 'identifier',
      confidence: 1,
      book: { id: bookId },
    });
    expect(service.confirmWorkMatch).toHaveBeenCalledWith(clubId, workId, 'reader-1', bookId);
  });

  it('rejects unsupported sources and unexpected reading-copy fields', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    const body = { source: 'none', bookId: '123e4567-e89b-42d3-a456-426614174003' };
    const unsupportedSource = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify(body),
    });
    const extraField = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'x-test-user': 'reader-1' },
      body: JSON.stringify({ ...body, source: 'personal', annotations: 'should not be accepted' }),
    });

    expect(unsupportedSource.status).toBe(400);
    expect(extraField.status).toBe(400);
    expect(service.setReadingCopy).not.toHaveBeenCalled();
  });

  it('clears the caller reading-copy choice for one logical work', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const workId = '123e4567-e89b-42d3-a456-426614174002';
    const response = await fetch(`${baseUrl}/book-clubs/${clubId}/works/${workId}/reading-copy`, {
      method: 'DELETE',
      headers: { 'x-test-user': 'reader-1' },
    });

    expect(response.status).toBe(204);
    expect(service.clearReadingCopy).toHaveBeenCalledWith(clubId, workId, 'reader-1');
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
      { method: 'GET', path: `/book-clubs/not-a-uuid/works/${validId}/reading-copy` },
      { method: 'GET', path: `/book-clubs/${validId}/works/not-a-uuid/reading-copy` },
      {
        method: 'PUT',
        path: `/book-clubs/${validId}/works/${validId}/reading-copy`,
        body: { source: 'personal', bookId: 'not-a-uuid' },
      },
      { method: 'DELETE', path: `/book-clubs/${validId}/works/not-a-uuid/reading-copy` },
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
    expect(service.getReadingCopy).not.toHaveBeenCalled();
    expect(service.setReadingCopy).not.toHaveBeenCalled();
    expect(service.clearReadingCopy).not.toHaveBeenCalled();
  });

  it('rejects non-UUID add-member and ownership-transfer target IDs at the API boundary', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174000';
    const requests = [
      {
        method: 'POST',
        path: `/book-clubs/${clubId}/members`,
        body: { userId: 'not-a-uuid' },
      },
      {
        method: 'POST',
        path: `/book-clubs/${clubId}/transfer-ownership`,
        body: { newOwnerUserId: 'not-a-uuid' },
      },
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: request.method,
        headers: { 'content-type': 'application/json', 'x-test-user': clubId },
        body: JSON.stringify(request.body),
      });
      expect(response.status).toBe(400);
    }

    expect(service.addMember).not.toHaveBeenCalled();
    expect(service.transferOwnership).not.toHaveBeenCalled();
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
