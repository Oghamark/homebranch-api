import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { KoreaderAuthService, SyncActor } from './koreader-auth.service';

export type SyncRequest = Request & { syncActor?: SyncActor };

@Injectable()
export class KoreaderDeviceGuard implements CanActivate {
  constructor(private readonly auth: KoreaderAuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SyncRequest>();
    request.syncActor = await this.auth.authenticate(request.headers['x-auth-user'], request.headers['x-auth-key']);
    await this.auth.assertEntitled(request.syncActor, !['GET', 'HEAD'].includes(request.method));
    return true;
  }
}

/** Used only by this module's explicitly scoped extension routes. */
@Injectable()
export class KoreaderSyncGuard implements CanActivate {
  constructor(
    private readonly devices: KoreaderDeviceGuard,
    private readonly jwt: JwtAuthGuard,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<SyncRequest>();
    if (request.headers['x-auth-user'] !== undefined || request.headers['x-auth-key'] !== undefined) {
      return this.devices.canActivate(context);
    }
    const valid = await this.jwt.canActivate(context);
    if (valid && request.user) request.syncActor = request.user;
    return valid;
  }
}
