import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/modules/auth/auth.module';
import { AuditLogEntity } from './audit-log.entity';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';
import { AuditLogMiddleware } from './audit-log.middleware';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLogEntity]), AuthModule],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogMiddleware],
})
export class AuditLogModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuditLogMiddleware).forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}
