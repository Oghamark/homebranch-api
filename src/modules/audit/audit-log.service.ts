import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogQueryDto } from './audit-log-query.dto';

export type AuditLogRecord = Omit<AuditLogEntity, 'id' | 'createdAt'>;

@Injectable()
export class AuditLogService {
  constructor(@InjectRepository(AuditLogEntity) private readonly logs: Repository<AuditLogEntity>) {}

  async record(entry: AuditLogRecord): Promise<void> {
    await this.logs.insert(entry);
  }

  async find(query: AuditLogQueryDto) {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException('The start date must not be after the end date');
    }
    const qb = this.logs.createQueryBuilder('log');
    if (query.actor?.trim()) {
      qb.andWhere('(CAST(log.actorId AS text) ILIKE :actor OR log.actorLabel ILIKE :actor)', {
        actor: `%${escapeLike(query.actor.trim())}%`,
      });
    }
    if (query.action?.trim()) {
      qb.andWhere("CONCAT(log.method, ' ', log.route) ILIKE :action", {
        action: `%${escapeLike(query.action.trim())}%`,
      });
    }
    if (query.outcome) {
      qb.andWhere('log.outcome = :outcome', { outcome: query.outcome });
    }
    if (query.from) qb.andWhere('log.createdAt >= :from', { from: new Date(query.from) });
    if (query.to) qb.andWhere('log.createdAt <= :to', { to: new Date(query.to) });
    const [data, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .take(query.limit)
      .skip(query.offset)
      .getManyAndCount();
    return { data, total, limit: query.limit, offset: query.offset };
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
