import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { Request } from 'express';
import { ExtractJwt } from 'passport-jwt';

type Account = { id: string; name: string };
const unavailable = () => new ServiceUnavailableException('Account directory is unavailable; retry later');

function validCredential(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 16384 && /^[A-Za-z0-9._~-]+$/.test(value);
}

/** Use only after JwtAuthGuard; match its cookie-first extraction precedence. */
export function accessCredential(request: Request): string {
  const credential: unknown = request.cookies?.['access_token'] || ExtractJwt.fromAuthHeaderAsBearerToken()(request);
  if (!validCredential(credential)) throw new UnauthorizedException();
  return credential;
}

@Injectable()
export class AccountDirectoryGateway {
  async search(query: string, credential: string): Promise<Account[]> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.trim().length > 254 || /\p{Cc}/u.test(query)) {
      throw new BadRequestException('Search query must contain 2 to 254 characters');
    }
    return this.lookup(`/users/social-search?${new URLSearchParams({ query: query.trim() })}`, credential, 20);
  }

  async requireAccount(id: string, credential: string): Promise<Account> {
    const accounts = await this.displayNames([id], credential);
    if (!accounts.length) throw new NotFoundException('Account is unavailable');
    return accounts[0];
  }

  async displayNames(ids: string[], credential: string): Promise<Account[]> {
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => typeof id !== 'string' || !isUUID(id))) {
      throw new BadRequestException('Display names require at most 1000 UUIDs');
    }
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    const accounts: Account[] = [];
    for (let offset = 0; offset < unique.length; offset += 50) {
      const chunk = unique.slice(offset, offset + 50);
      const rows = await this.lookup('/users/display-names', credential, chunk.length, {
        userIds: chunk,
      });
      if (rows.some(({ id }) => !chunk.includes(id))) throw unavailable();
      accounts.push(...rows);
    }
    return accounts;
  }

  private async lookup(
    path: string,
    credential: string,
    limit: number,
    body?: { userIds: string[] },
  ): Promise<Account[]> {
    if (!validCredential(credential)) throw new UnauthorizedException();
    let url: URL;
    try {
      const configured = process.env.AUTH_SERVICE_URL;
      if (!configured) throw unavailable();
      url = new URL(configured);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw unavailable();
      }
      url = new URL(`${url.toString().replace(/\/$/, '')}${path}`);
    } catch {
      throw unavailable();
    }
    let response: Response;
    let payload: unknown;
    try {
      response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          Cookie: `access_token=${credential}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
      } else {
        if (!response.headers.get('content-type')?.includes('application/json')) {
          await response.body?.cancel();
          throw unavailable();
        }
        const reader = response.body?.getReader();
        if (!reader) throw unavailable();
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 65536) {
            await reader.cancel();
            throw unavailable();
          }
          chunks.push(value);
        }
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      }
    } catch {
      // Do not attach upstream errors: they may contain credentials or private data.
      throw unavailable();
    }
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException('Sign in again to access the account directory');
    }
    if (response.status === 429) {
      throw new HttpException('Account search limit reached; retry in one minute', 429);
    }
    if (!response.ok || !this.isAccountResponse(payload, limit)) throw unavailable();
    return payload.value.map(({ id, name }) => ({ id: id.toLowerCase(), name }));
  }

  private isAccountResponse(payload: unknown, limit: number): payload is { success: true; value: Account[] } {
    if (!payload || typeof payload !== 'object') return false;
    const { success, value } = payload as Record<string, unknown>;
    if (success !== true || !Array.isArray(value) || value.length > limit) return false;
    const seen = new Set<string>();
    return value.every((row: unknown) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const account = row as Record<string, unknown>;
      if (
        Object.keys(account).length !== 2 ||
        typeof account.id !== 'string' ||
        !isUUID(account.id) ||
        typeof account.name !== 'string' ||
        !account.name.trim() ||
        account.name.length > 255 ||
        /\p{Cc}/u.test(account.name) ||
        seen.has(account.id.toLowerCase())
      )
        return false;
      seen.add(account.id.toLowerCase());
      return true;
    });
  }
}
