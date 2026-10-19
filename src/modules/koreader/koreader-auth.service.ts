import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { EntitlementService } from '../cloud/entitlement.service';
import { object, text } from './koreader-validation';
import { lockSyncUser } from './koreader-ordering';

export interface SyncActor {
  id: string;
  roles?: string[];
  deviceId?: string;
}

export const verifier = (secret: string): string => createHash('sha256').update(secret).digest('hex');
export function verifySecret(secret: string, expected: string): boolean {
  const actual = Buffer.from(verifier(secret), 'hex');
  const stored = /^[a-f0-9]{64}$/.test(expected) ? Buffer.from(expected, 'hex') : Buffer.alloc(32);
  return timingSafeEqual(actual, stored);
}

@Injectable()
export class KoreaderAuthService implements OnModuleInit {
  constructor(
    private readonly db: DataSource,
    private readonly entitlements: EntitlementService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'production') {
      let url: URL;
      try {
        url = new URL(process.env.APP_URL ?? '');
      } catch {
        throw new Error('KOReader requires HTTPS APP_URL');
      }
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('KOReader requires HTTPS APP_URL');
    }
  }

  async rate(scope: string, subject: string, maximum: number): Promise<void> {
    const minute = Math.floor(Date.now() / 60000);
    const bucket = `${scope}:${verifier(subject)}:${minute}`;
    const [row] = await this.db.query(
      `INSERT INTO koreader_rate(bucket,count,expires_at) VALUES($1,1,now()+interval '2 minutes')
       ON CONFLICT(bucket) DO UPDATE SET count=koreader_rate.count+1 RETURNING count`,
      [bucket],
    );
    if (row.count > maximum) throw new HttpException('Too many requests; retry later', 429);
  }

  async createPairing(body: unknown, ip: string) {
    await this.rate('pair', ip, 5);
    const name = text(object(body).deviceName, 128);
    const deviceCode = randomBytes(32).toString('base64url');
    const userCode = randomBytes(5).toString('hex').toUpperCase();
    await this.db.transaction(async (manager) => {
      await manager.query(`DELETE FROM koreader_rate WHERE expires_at<now()`);
      await manager.query(`DELETE FROM koreader_pairing WHERE expires_at<now()`);
      await manager.query(
        `INSERT INTO koreader_pairing(verifier,code_verifier,name,expires_at)
         VALUES($1,$2,$3,now()+interval '10 minutes')`,
        [verifier(deviceCode), verifier(userCode), name],
      );
    });
    return {
      deviceCode,
      userCode,
      verificationPath: `/settings?section=koreader&code=${userCode}`,
      expiresIn: 600,
      interval: 5,
    };
  }

  async approve(body: unknown, actor: SyncActor) {
    await this.rate('approve', actor.id, 20);
    const code = text(object(body).userCode, 32).replace(/[\s-]/g, '').toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(code)) throw new NotFoundException('Pairing code unavailable');
    const rows = await this.db.query(
      `UPDATE koreader_pairing SET user_id=$2
       WHERE code_verifier=$1 AND expires_at>now() AND user_id IS NULL AND claimed_at IS NULL RETURNING verifier`,
      [verifier(code), actor.id],
    );
    if (rows[0].length === 0) throw new NotFoundException('Pairing code unavailable');
    return { state: 'approved' as const };
  }

  async claim(body: unknown, ip: string) {
    await this.rate('claim', ip, 60);
    const deviceCode = text(object(body).deviceCode, 64);
    if (!/^[A-Za-z0-9_-]{43}$/.test(deviceCode)) throw new UnauthorizedException('Pairing unavailable');
    return this.db.transaction(async (manager) => {
      const [pair] = await manager.query(
        `SELECT * FROM koreader_pairing WHERE verifier=$1 AND expires_at>now() AND claimed_at IS NULL FOR UPDATE`,
        [verifier(deviceCode)],
      );
      if (!pair) throw new UnauthorizedException('Pairing unavailable');
      if (pair.last_poll_at && Date.now() - new Date(pair.last_poll_at).getTime() < 5000) {
        throw new HttpException('Poll no more than once every five seconds', 429);
      }
      await manager.query(`UPDATE koreader_pairing SET last_poll_at=now() WHERE verifier=$1`, [pair.verifier]);
      if (!pair.user_id) return { state: 'pending' as const };
      await this.assertEntitled({ id: pair.user_id }, true);
      await lockSyncUser(manager, pair.user_id);
      const [{ count }] = await manager.query(
        `SELECT count(*)::int AS count FROM koreader_device WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now()`,
        [pair.user_id],
      );
      if (count >= 50) throw new ForbiddenException('Revoke an existing device before pairing another');
      const key = randomBytes(32).toString('base64url');
      const username = `hb_${randomBytes(18).toString('hex')}`;
      const deviceId = randomUUID();
      await manager.query(
        `INSERT INTO koreader_device(id,user_id,username,verifier,name,created_at,expires_at)
         VALUES($1,$2,$3,$4,$5,now(),now()+interval '365 days')`,
        [deviceId, pair.user_id, username, verifier(key), pair.name],
      );
      await manager.query(`UPDATE koreader_pairing SET claimed_at=now() WHERE verifier=$1`, [pair.verifier]);
      return { state: 'approved' as const, username, key, deviceId };
    });
  }

  async authenticate(username: unknown, key: unknown): Promise<SyncActor> {
    if (
      typeof username !== 'string' ||
      !/^hb_[a-f0-9]{36}$/.test(username) ||
      typeof key !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(key)
    )
      throw new UnauthorizedException();
    const [device] = await this.db.query(
      `SELECT id,user_id,verifier FROM koreader_device WHERE username=$1 AND revoked_at IS NULL AND expires_at>now()`,
      [username],
    );
    // Always perform a fixed-size comparison, including unknown usernames.
    const valid = verifySecret(key, device?.verifier ?? '0'.repeat(64));
    if (!device || !valid) throw new UnauthorizedException();
    return { id: device.user_id, roles: [], deviceId: device.id };
  }

  async assertEntitled(actor: SyncActor, write: boolean): Promise<void> {
    if (!this.entitlements.cloudMode) return;
    if (!actor.deviceId && actor.roles?.includes('ADMIN')) return;
    const state = await this.entitlements.getState(actor.id);
    if (state === 'blocked' || (write && state !== 'active')) {
      throw new ForbiddenException('Sync unavailable for this subscription');
    }
  }

  /** Recheck under the same transaction lock as every device operation, including reads. */
  async lockActor(manager: EntityManager, actor: SyncActor, write: boolean) {
    if (actor.deviceId) {
      const [device] = await manager.query(
        `SELECT id FROM koreader_device WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL
         AND expires_at>now() FOR UPDATE`,
        [actor.deviceId, actor.id],
      );
      if (!device) throw new UnauthorizedException();
      await manager.query(`UPDATE koreader_device SET last_seen_at=now() WHERE id=$1`, [actor.deviceId]);
    }
    await this.assertEntitled(actor, write);
    await lockSyncUser(manager, actor.id);
  }

  async devices(actor: SyncActor) {
    const rows = await this.db.query<
      {
        id: string;
        name: string;
        createdAt: Date;
        lastSeenAt: Date | null;
        expiresAt: Date;
      }[]
    >(
      `SELECT id,name,created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt"
       FROM koreader_device WHERE user_id=$1 AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at,id`,
      [actor.id],
    );
    return rows;
  }

  async revoke(actor: SyncActor, id: string) {
    const rows = await this.db.query(
      `UPDATE koreader_device SET revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING id`,
      [id, actor.id],
    );
    if (!rows[0].length) throw new NotFoundException('Device unavailable');
  }
}
