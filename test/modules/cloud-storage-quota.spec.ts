import { PayloadTooLargeException } from '@nestjs/common';
import { StorageQuotaService } from 'src/modules/cloud/storage-quota.service';

describe('StorageQuotaService', () => {
  const build = (usedBytes: number, usedBooks = 0, quotaBytes = 5 * 1024 ** 3, maxBooks: number | null = null) => {
    let selected = '';
    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      select: jest.fn(),
      getRawOne: jest.fn(async () => ({
        total: String(selected.startsWith('COUNT') ? usedBooks : usedBytes),
      })),
    };
    qb.select.mockImplementation((selection: string) => {
      selected = selection;
      return qb;
    });
    const formats = { createQueryBuilder: () => qb };
    const entitlements = { getLimits: jest.fn().mockResolvedValue({ quotaBytes, maxBooks, state: 'active' }) };
    return new StorageQuotaService(formats as never, entitlements as never);
  };

  it('allows uploads within the plan storage allowance and rejects uploads beyond it', async () => {
    await expect(build(60, 0, 100).assertCanStore('u', 40)).resolves.toBeUndefined();
    await expect(build(60, 0, 100).assertCanStore('u', 41)).rejects.toThrow(PayloadTooLargeException);
  });

  it('enforces the demo book limit but permits paid plans to add more', async () => {
    await expect(build(0, 4, 5 * 1024 ** 3, 5).assertCanAddBook('u')).resolves.toBeUndefined();
    await expect(build(0, 5, 5 * 1024 ** 3, 5).assertCanAddBook('u')).rejects.toThrow(PayloadTooLargeException);
    await expect(build(0, 5).assertCanAddBook('u')).resolves.toBeUndefined();
  });

  it('reports byte and book usage with the account plan limits', async () => {
    await expect(build(25, 3, 100, 5).getUsage('u')).resolves.toEqual({
      usedBytes: 25,
      quotaBytes: 100,
      usedBooks: 3,
      maxBooks: 5,
    });
  });
});
