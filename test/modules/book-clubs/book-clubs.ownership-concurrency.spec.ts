import { DataSource, EntityManager } from 'typeorm';
import { BookClubRole, BookClubStatus, BookClubVisibility } from 'src/modules/book-clubs/book-club.types';
import { BookClubEntity } from 'src/modules/book-clubs/entities/book-club.entity';
import { BookClubMemberEntity } from 'src/modules/book-clubs/entities/book-club-member.entity';
import { BookClubsService } from 'src/modules/book-clubs/book-clubs.service';

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('BookClubsService ownership concurrency', () => {
  it('serializes a stale role update behind ownership transfer', async () => {
    const club = {
      id: 'club-1',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    };
    const members = new Map<string, { clubId: string; userId: string; role: BookClubRole }>([
      ['owner-1', { clubId: club.id, userId: 'owner-1', role: BookClubRole.OWNER }],
      ['member-2', { clubId: club.id, userId: 'member-2', role: BookClubRole.MEMBER }],
    ]);
    const transferTargetRead = deferred();
    const allowTransferToContinue = deferred();
    const roleUpdateReachedSave = deferred();
    const allowRoleUpdateToSave = deferred();
    const roleUpdateLockRequested = deferred();

    let transactionCount = 0;
    let lockTail: Promise<void> = Promise.resolve();
    let locksHeld = 0;
    const acquireClubLock = async (): Promise<() => void> => {
      if (locksHeld > 0) roleUpdateLockRequested.resolve();
      const previous = lockTail;
      let release!: () => void;
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      locksHeld += 1;
      return () => {
        locksHeld -= 1;
        release();
      };
    };

    const dataSource = {
      transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => {
        const transactionId = transactionCount++;
        let releaseClubLock: (() => void) | undefined;
        const clubRepository = {
          findOne: async (options: { lock?: { mode?: string } }) => {
            if (options.lock?.mode === 'pessimistic_write' && !releaseClubLock) {
              releaseClubLock = await acquireClubLock();
            }
            return { ...club };
          },
          save: (value: typeof club) => {
            Object.assign(club, value);
            return Promise.resolve(value);
          },
        };
        const memberRepository = {
          findOne: async (options: { where: { clubId: string; userId: string } }) => {
            const member = members.get(options.where.userId);
            if (!member || member.clubId !== options.where.clubId) return undefined;
            const snapshot = { ...member };
            if (transactionId === 0 && member.userId === 'member-2') {
              transferTargetRead.resolve();
              await allowTransferToContinue.promise;
            }
            return snapshot;
          },
          save: async (value: { clubId: string; userId: string; role: BookClubRole }) => {
            if (transactionId === 1 && value.userId === 'member-2') {
              roleUpdateReachedSave.resolve();
              await allowRoleUpdateToSave.promise;
            }
            members.set(value.userId, { ...value });
            return value;
          },
        };
        const repositories = new Map<unknown, unknown>([
          [BookClubEntity, clubRepository],
          [BookClubMemberEntity, memberRepository],
        ]);
        const manager = {
          getRepository: (entity: unknown) => repositories.get(entity),
        } as unknown as EntityManager;

        try {
          return await callback(manager);
        } finally {
          releaseClubLock?.();
        }
      },
    } as unknown as DataSource;
    const service = new BookClubsService(dataSource);

    const transfer = service.transferOwnership(club.id, 'owner-1', 'member-2');
    await transferTargetRead.promise;
    const roleUpdate = service.updateMemberRole(club.id, 'owner-1', 'member-2', BookClubRole.MODERATOR);

    const interleaving = await Promise.race([
      roleUpdateReachedSave.promise.then(() => 'stale-role-update' as const),
      roleUpdateLockRequested.promise.then(() => 'serialized' as const),
    ]);

    if (interleaving === 'stale-role-update') {
      allowTransferToContinue.resolve();
      await transfer;
      allowRoleUpdateToSave.resolve();
      await roleUpdate;
    } else {
      allowTransferToContinue.resolve();
      await transfer;
      await expect(roleUpdate).rejects.toThrow('Only the club owner can perform this action');
    }

    const ownerMemberships = [...members.values()].filter((member) => member.role === BookClubRole.OWNER);
    expect(club.ownerUserId).toBe('member-2');
    expect(ownerMemberships.map((member) => member.userId)).toEqual(['member-2']);
  });

  it('keeps the transferred owner membership when a concurrent removal has a stale read', async () => {
    const club = {
      id: 'club-1',
      ownerUserId: 'owner-1',
      visibility: BookClubVisibility.PRIVATE,
      status: BookClubStatus.ACTIVE,
    };
    const members = new Map<string, { clubId: string; userId: string; role: BookClubRole }>([
      ['owner-1', { clubId: club.id, userId: 'owner-1', role: BookClubRole.OWNER }],
      ['moderator-1', { clubId: club.id, userId: 'moderator-1', role: BookClubRole.MODERATOR }],
      ['member-2', { clubId: club.id, userId: 'member-2', role: BookClubRole.MEMBER }],
    ]);
    const transferTargetRead = deferred();
    const allowTransferToContinue = deferred();
    const removalReachedDelete = deferred();
    const allowRemovalToDelete = deferred();
    const removalLockRequested = deferred();
    const removalDeleteCompleted = deferred();

    let transactionCount = 0;
    let transferTransaction: number | undefined;
    let lockTail: Promise<void> = Promise.resolve();
    let locksHeld = 0;
    const acquireClubLock = async (): Promise<() => void> => {
      if (locksHeld > 0) removalLockRequested.resolve();
      const previous = lockTail;
      let release!: () => void;
      lockTail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      locksHeld += 1;
      return () => {
        locksHeld -= 1;
        release();
      };
    };

    const dataSource = {
      transaction: async (callback: (manager: EntityManager) => Promise<unknown>) => {
        const transactionId = transactionCount++;
        if (transactionId === 0) transferTransaction = transactionId;
        let releaseClubLock: (() => void) | undefined;
        const clubRepository = {
          findOne: async (options: { lock?: { mode?: string } }) => {
            if (options.lock?.mode === 'pessimistic_write' && !releaseClubLock) {
              releaseClubLock = await acquireClubLock();
            }
            return { ...club };
          },
          save: (value: typeof club) => {
            Object.assign(club, value);
            return Promise.resolve(value);
          },
        };
        const memberRepository = {
          findOne: async (options: { where: { clubId: string; userId: string } }) => {
            const member = members.get(options.where.userId);
            if (!member || member.clubId !== options.where.clubId) return undefined;
            const snapshot = { ...member };
            if (transactionId === transferTransaction && member.userId === 'member-2') {
              transferTargetRead.resolve();
              await allowTransferToContinue.promise;
            }
            return snapshot;
          },
          save: (value: { clubId: string; userId: string; role: BookClubRole }) => {
            members.set(value.userId, { ...value });
            return Promise.resolve(value);
          },
          delete: async (criteria: { clubId: string; userId: string }) => {
            removalReachedDelete.resolve();
            await allowRemovalToDelete.promise;
            members.delete(criteria.userId);
            removalDeleteCompleted.resolve();
            return { affected: 1 };
          },
        };
        const repositories = new Map<unknown, unknown>([
          [BookClubEntity, clubRepository],
          [BookClubMemberEntity, memberRepository],
        ]);
        const manager = {
          getRepository: (entity: unknown) => repositories.get(entity),
        } as unknown as EntityManager;

        try {
          return await callback(manager);
        } finally {
          releaseClubLock?.();
        }
      },
    } as unknown as DataSource;
    const service = new BookClubsService(dataSource);

    const transfer = service.transferOwnership(club.id, 'owner-1', 'member-2');
    await transferTargetRead.promise;
    const removal = service.removeMember(club.id, 'moderator-1', 'member-2');

    const interleaving = await Promise.race([
      removalReachedDelete.promise.then(() => 'stale-removal' as const),
      removalLockRequested.promise.then(() => 'serialized' as const),
    ]);

    if (interleaving === 'stale-removal') {
      allowTransferToContinue.resolve();
      await transfer;
      allowRemovalToDelete.resolve();
      await removalDeleteCompleted.promise;
      await removal;
    } else {
      allowTransferToContinue.resolve();
      await transfer;
      await expect(removal).rejects.toThrow('Transfer ownership before removing the owner');
    }

    const ownerMemberships = [...members.values()].filter((member) => member.role === BookClubRole.OWNER);
    expect(club.ownerUserId).toBe('member-2');
    expect(ownerMemberships.map((member) => member.userId)).toEqual(['member-2']);
  });
});
