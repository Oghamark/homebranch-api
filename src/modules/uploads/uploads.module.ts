import { Module } from '@nestjs/common';
import { UploadsController } from './uploads.controller';
import { StorageModule } from '../storage/storage.module';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { UploadSessionController } from './upload-session.controller';
import { UploadSessionService } from './upload-session.service';

@Module({
  imports: [StorageModule, ConfigModule, AuthModule],
  controllers: [UploadSessionController, UploadsController],
  providers: [UploadSessionService],
  exports: [UploadSessionService],
})
export class UploadsModule {}
