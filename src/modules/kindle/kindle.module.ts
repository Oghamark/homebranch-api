import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/modules/auth/auth.module';
import { BookCoreModule } from 'src/modules/book/book-core.module';
import { KindleController } from 'src/modules/kindle/kindle.controller';
import { KindleService } from 'src/modules/kindle/kindle.service';
import { UserPreferenceEntity } from 'src/modules/kindle/user-preference.entity';
import { MailModule } from 'src/modules/mail/mail.module';
import { StorageModule } from 'src/modules/storage/storage.module';

@Module({
  imports: [TypeOrmModule.forFeature([UserPreferenceEntity]), AuthModule, BookCoreModule, MailModule, StorageModule],
  providers: [KindleService],
  controllers: [KindleController],
})
export class KindleModule {}
