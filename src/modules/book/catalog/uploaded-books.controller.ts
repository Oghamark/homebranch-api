import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { UploadSessionService } from 'src/modules/uploads/upload-session.service';
import { UploadedAudiobookPreviewDto, UploadedBookDto } from 'src/modules/uploads/upload-session.dto';
import { BookCreationService } from './book-creation.service';

@Controller('books')
@UseGuards(JwtAuthGuard)
export class UploadedBooksController {
  constructor(
    private readonly sessions: UploadSessionService,
    private readonly books: BookCreationService,
  ) {}

  @Post('from-upload')
  createBook(@CurrentUser() user: Express.User, @Body() request: UploadedBookDto) {
    return this.sessions.consume(user.id, request.uploadId, async (files) => {
      if (files.length !== 1) throw new BadRequestException('A book upload requires one file');
      return this.books.createBook({
        filePath: files[0].path,
        title: request.title,
        author: request.author,
        isFavorite: request.isFavorite,
        uploadedByUserId: user.id,
      });
    });
  }

  @Post('audiobook/from-upload')
  createAudiobook(@CurrentUser() user: Express.User, @Body() request: UploadedBookDto) {
    return this.sessions.consume(user.id, request.uploadId, (files) =>
      this.books.createAudiobook(files, request.title, request.author, user.id),
    );
  }

  @Post('audiobook/preview-from-upload')
  previewAudiobook(@CurrentUser() user: Express.User, @Body() request: UploadedAudiobookPreviewDto) {
    return this.sessions.consume(user.id, request.uploadId, (files) =>
      this.books.previewAudiobook(files, request.relativePaths),
    );
  }
}
