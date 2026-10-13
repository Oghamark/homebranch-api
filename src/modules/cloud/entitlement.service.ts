import { Injectable, Logger } from '@nestjs/common';

export type EntitlementState = 'active' | 'read_only' | 'blocked';

export interface AccountLimits {
  state: EntitlementState;
  quotaBytes: number;
  maxBooks: number | null;
}

interface CacheEntry extends AccountLimits {
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;

@Injectable()
export class EntitlementService {
  private readonly logger = new Logger(EntitlementService.name);
  private readonly cache = new Map<string, CacheEntry>();

  get cloudMode(): boolean {
    return process.env.CLOUD_MODE === 'true';
  }

  async getState(userId: string): Promise<EntitlementState> {
    return (await this.getLimits(userId)).state;
  }

  async getLimits(userId: string): Promise<AccountLimits> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      const { state, quotaBytes, maxBooks } = cached;
      return { state, quotaBytes, maxBooks };
    }

    const limits = await this.fetchLimits(userId);
    this.cache.set(userId, { ...limits, expiresAt: Date.now() + CACHE_TTL_MS });
    return limits;
  }

  // Fails closed: any problem reaching the portal blocks access.
  private async fetchLimits(userId: string): Promise<AccountLimits> {
    const portalUrl = process.env.PORTAL_URL;
    const serviceKey = process.env.PORTAL_SERVICE_KEY;
    if (!portalUrl || !serviceKey) {
      this.logger.error('CLOUD_MODE requires PORTAL_URL and PORTAL_SERVICE_KEY');
      return { state: 'blocked', quotaBytes: 0, maxBooks: 0 };
    }

    try {
      const response = await fetch(`${portalUrl}/internal/entitlements/${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      if (!response.ok) return { state: 'blocked', quotaBytes: 0, maxBooks: 0 };
      const body = (await response.json()) as Partial<AccountLimits>;
      const maxBooks =
        body.maxBooks === null
          ? null
          : typeof body.maxBooks === 'number' && Number.isInteger(body.maxBooks) && body.maxBooks >= 0
            ? body.maxBooks
            : 0;
      return {
        state: body.state === 'active' || body.state === 'read_only' ? body.state : 'blocked',
        quotaBytes: Number.isFinite(body.quotaBytes) && body.quotaBytes! >= 0 ? body.quotaBytes! : 0,
        maxBooks,
      };
    } catch (err) {
      this.logger.error('Failed to reach portal for entitlement check', err);
      return { state: 'blocked', quotaBytes: 0, maxBooks: 0 };
    }
  }
}
