import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BookCoreModule } from '../book/book-core.module';
import { StorageModule } from '../storage/storage.module';
import { KoreaderAuthService } from './koreader-auth.service';
import { KoreaderDeviceGuard, KoreaderSyncGuard } from './koreader.guard';
import { KoreaderService } from './koreader.service';
import { KoreaderDocumentService } from './koreader-document.service';
import {
  KoreaderExtensionController,
  KoreaderNativeController,
  KoreaderPairingController,
} from './koreader.controller';

@Module({
  imports: [AuthModule, BookCoreModule, StorageModule],
  providers: [KoreaderAuthService, KoreaderDeviceGuard, KoreaderSyncGuard, KoreaderService, KoreaderDocumentService],
  controllers: [KoreaderPairingController, KoreaderNativeController, KoreaderExtensionController],
})
export class KoreaderModule {}
