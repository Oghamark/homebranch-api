import { Controller, Delete, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { isCloudMode } from 'src/common/utils/cloud';
import { PortalServiceKeyGuard } from './service-key.guard';
import { StorageQuotaService } from './storage-quota.service';
import { TenantPurgeService } from './tenant-purge.service';

@Controller('internal/tenants')
@UseGuards(PortalServiceKeyGuard)
export class TenantPurgeController {
  constructor(
    private readonly purgeService: TenantPurgeService,
    private readonly quota: StorageQuotaService,
  ) {}

  /** Batch usage for the portal's admin view. `ids` is a comma separated list of user ids. */
  @Get('usage')
  usage(@Query('ids') ids = '') {
    if (!isCloudMode()) throw new NotFoundException();
    const userIds = ids
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 100);
    return this.quota.getUsageForUsers(userIds);
  }

  @Delete(':userId')
  purge(@Param('userId') userId: string) {
    if (!isCloudMode()) throw new NotFoundException();
    return this.purgeService.purge(userId);
  }
}
