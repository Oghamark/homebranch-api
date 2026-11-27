import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { AuditLogQueryDto } from './audit-log-query.dto';
import { AuditLogService } from './audit-log.service';

@Controller('audit-logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class AuditLogController {
  constructor(private readonly logs: AuditLogService) {}

  @Get()
  find(@Query() query: AuditLogQueryDto) {
    return this.logs.find(query);
  }
}
