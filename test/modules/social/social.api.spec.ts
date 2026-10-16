import { ExecutionContext, INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { ClubSocialController, NotificationsController, SocialController } from 'src/modules/social/social.controller';
import { SocialService } from 'src/modules/social/social.service';

describe('Social HTTP contracts', () => {
  const actor = '123e4567-e89b-42d3-a456-426614174001';
  const target = '123e4567-e89b-42d3-a456-426614174002';
  const id = '123e4567-e89b-42d3-a456-426614174003';
  const service = {
    search: jest.fn(),
    friends: jest.fn(),
    requests: jest.fn(),
    sendFriend: jest.fn(),
    friendAction: jest.fn(),
    removeFriend: jest.fn(),
    settings: jest.fn(),
    blocks: jest.fn(),
    block: jest.fn(),
    unblock: jest.fn(),
    invitations: jest.fn(),
    sendInvitation: jest.fn(),
    invitationAction: jest.fn(),
    activityPreference: jest.fn(),
    notifications: jest.fn(),
    notificationAction: jest.fn(),
  };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [SocialController, ClubSocialController, NotificationsController],
      providers: [{ provide: SocialService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const request = context
            .switchToHttp()
            .getRequest<{ user?: { id: string }; headers: Record<string, string> }>();
          if (!request.headers.authorization) throw new UnauthorizedException();
          request.user = { id: actor };
          return true;
        },
      })
      .compile();
    app = module.createNestApplication();
    await app.listen(0);
    base = await app.getUrl();
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  async function request(path: string, method = 'GET', body?: object) {
    return fetch(`${base}${path}`, {
      method,
      headers: { authorization: 'Bearer verified', 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  it('requires authentication across every controller', async () => {
    for (const route of ['/social/friends', '/notifications', `/book-clubs/${id}/invitations`]) {
      expect((await fetch(`${base}${route}`)).status).toBe(401);
    }
  });

  it('uses the canonical people and friend-list wire shapes', async () => {
    service.search.mockResolvedValue([{ id: target, name: 'Reader' }]);
    const response = await request('/social/people?q=Reader');
    expect(await response.json()).toEqual([{ id: target, name: 'Reader' }]);
    expect(service.search).toHaveBeenCalledWith(actor, 'Reader', 'verified');
    service.friends.mockResolvedValue([{ userId: target, name: 'Reader' }]);
    expect(await (await request('/social/friends')).json()).toEqual([{ userId: target, name: 'Reader' }]);
    service.requests.mockResolvedValue({
      incoming: [{ id, userId: target, name: 'Reader', createdAt: 'date' }],
      outgoing: [],
    });
    expect(await (await request('/social/friend-requests')).json()).toHaveProperty('incoming');
  });

  it('derives all action identities from the guard and never accepts a body actor', async () => {
    expect((await request('/social/friend-requests', 'POST', { userId: target })).status).toBe(201);
    expect(service.sendFriend).toHaveBeenCalledWith(actor, target, 'verified');
    expect((await request('/social/friend-requests', 'POST', { userId: target, actorId: target })).status).toBe(400);
    expect((await request('/social/friend-requests', 'POST', { userId: 'invalid' })).status).toBe(400);
    for (const action of ['accept', 'decline', 'cancel']) {
      await request(`/social/friend-requests/${id}/${action}`, 'POST');
      expect(service.friendAction).toHaveBeenCalledWith(actor, id, action);
    }
  });

  it('accepts only declared settings/block shapes', async () => {
    await request('/social/settings', 'PATCH', { allowFriendRequests: false, clubInvites: 'friends' });
    expect(service.settings).toHaveBeenCalledWith(actor, { allowFriendRequests: false, clubInvites: 'friends' });
    expect((await request('/social/settings', 'PATCH', { clubInvites: 'email' })).status).toBe(400);
    expect((await request('/social/settings', 'PATCH', { allowFriendRequests: 'false' })).status).toBe(400);
    await request('/social/blocks', 'POST', { userId: target });
    expect(service.block).toHaveBeenCalledWith(actor, target, 'verified');
    await request(`/social/blocks/${target}`, 'DELETE');
    expect(service.unblock).toHaveBeenCalledWith(actor, target);
  });

  it('routes organizer and recipient invitation actions separately and disallows role assignments', async () => {
    await request(`/book-clubs/${id}/invitations`, 'POST', { userId: target });
    expect(service.sendInvitation).toHaveBeenCalledWith(actor, id, target, 'verified');
    expect((await request(`/book-clubs/${id}/invitations`, 'POST', { userId: target, role: 'moderator' })).status).toBe(
      400,
    );
    await request(`/book-clubs/${id}/invitations/${target}/cancel`, 'POST');
    expect(service.invitationAction).toHaveBeenCalledWith(actor, target, 'cancel', id);
    await request(`/social/club-invitations/${target}/accept`, 'POST');
    expect(service.invitationAction).toHaveBeenCalledWith(actor, target, 'accept');
    await request(`/social/club-invitations/${target}/decline`, 'POST');
    expect(service.invitationAction).toHaveBeenCalledWith(actor, target, 'decline');
  });

  it('uses GET/PUT activity-preference with a strict boolean', async () => {
    service.activityPreference.mockResolvedValue({ muted: true });
    expect(await (await request(`/book-clubs/${id}/activity-preference`, 'PUT', { muted: true })).json()).toEqual({
      muted: true,
    });
    expect(service.activityPreference).toHaveBeenCalledWith(actor, id, true);
    await request(`/book-clubs/${id}/activity-preference`);
    expect(service.activityPreference).toHaveBeenCalledWith(actor, id);
    expect((await request(`/book-clubs/${id}/activity-preference`, 'PUT', { muted: 'true' })).status).toBe(400);
  });

  it('parses numeric pagination, returns count shape, and owns inbox mutations', async () => {
    service.notifications.mockResolvedValue({ items: [], total: 0, unreadCount: 7, page: 2, limit: 10 });
    const response = await request('/notifications?page=2&limit=10');
    expect(await response.json()).toEqual({ items: [], total: 0, unreadCount: 7, page: 2, limit: 10 });
    expect(service.notifications).toHaveBeenCalledWith(actor, 2, 10, 'verified');
    expect(await (await request('/notifications/unread-count')).json()).toEqual({ count: 7 });
    await request('/notifications/read-all', 'POST');
    expect(service.notificationAction).toHaveBeenCalledWith(actor, 'read-all');
    await request(`/notifications/${id}/read`, 'POST');
    expect(service.notificationAction).toHaveBeenCalledWith(actor, 'read', id);
    await request(`/notifications/${id}`, 'DELETE');
    expect(service.notificationAction).toHaveBeenCalledWith(actor, 'dismiss', id);
    expect((await request('/notifications/invalid/read', 'POST')).status).toBe(400);
  });
});
