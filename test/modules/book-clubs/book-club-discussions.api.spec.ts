import { CanActivate, ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { BookClubsController } from 'src/modules/book-clubs/book-clubs.controller';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';
import { BookClubDiscussionService } from 'src/modules/book-clubs/book-club-discussion.service';
class Guard implements CanActivate {
  canActivate(c: ExecutionContext) {
    const r = c.switchToHttp().getRequest<any>();
    if (!r.headers['x-test-user']) throw new UnauthorizedException();
    r.user = { id: r.headers['x-test-user'] };
    return true;
  }
}
describe('discussion API', () => {
  let app: INestApplication;
  let url: string;
  const discussion = {
    listThreads: jest.fn(),
    createThread: jest.fn(),
    listReplies: jest.fn(),
    createReply: jest.fn(),
    editThread: jest.fn(),
    editReply: jest.fn(),
    deleteOwnThread: jest.fn(),
    deleteOwnReply: jest.fn(),
    moderateThread: jest.fn(),
    moderateReply: jest.fn(),
    getAudit: jest.fn(),
    listRecoveryTargets: jest.fn(),
  };
  beforeAll(async () => {
    const m = await Test.createTestingModule({
      controllers: [BookClubsController],
      providers: [
        { provide: BookClubsService, useValue: {} },
        { provide: BookClubDiscussionService, useValue: discussion },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(Guard)
      .compile();
    app = m.createNestApplication();
    await app.listen(0);
    url = await app.getUrl();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());
  it('routes spoiler reveal only when the query explicitly requests it', async () => {
    discussion.listThreads.mockResolvedValue([]);
    const id = '123e4567-e89b-42d3-a456-426614174001';
    const response = await fetch(`${url}/book-clubs/${id}/discussions?revealSpoilers=true`, {
      headers: { 'x-test-user': 'reader' },
    });
    expect(response.status).toBe(200);
    expect(discussion.listThreads).toHaveBeenCalledWith(id, 'reader', true);
  });
  it('rejects an invalid moderation action before invoking the discussion service', async () => {
    const clubId = '123e4567-e89b-42d3-a456-426614174001';
    const threadId = '123e4567-e89b-42d3-a456-426614174002';
    const response = await fetch(`${url}/book-clubs/${clubId}/discussions/${threadId}/moderation/invented`, {
      method: 'POST',
      headers: { 'x-test-user': 'moderator' },
    });
    expect(response.status).toBe(400);
    expect(discussion.moderateThread).not.toHaveBeenCalled();
  });
  it('routes moderator recovery target reads without accepting content query parameters', async () => {
    discussion.listRecoveryTargets.mockResolvedValue([]);
    const id = '123e4567-e89b-42d3-a456-426614174001';
    const response = await fetch(`${url}/book-clubs/${id}/discussion-recovery-targets?revealSpoilers=true`, {
      headers: { 'x-test-user': 'moderator' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    expect(discussion.listRecoveryTargets).toHaveBeenCalledWith(id, 'moderator');
  });
});
