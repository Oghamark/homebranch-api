import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavedPositionEntity } from 'src/modules/saved-position/saved-position.entity';
import { SavedPositionController } from 'src/modules/saved-position/saved-position.controller';
import { AuthModule } from 'src/modules/auth/auth.module';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';
import { BookPublicationModule } from '../book/publication/book-publication.module';

@Module({
  imports: [TypeOrmModule.forFeature([SavedPositionEntity]), AuthModule, BookPublicationModule],
  providers: [SavedPositionService],
  controllers: [SavedPositionController],
  exports: [SavedPositionService],
})
export class SavedPositionsModule {}
