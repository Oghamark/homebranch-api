import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { CreateUploadSessionDto } from './upload-session.dto';
import { UPLOAD_CHUNK_SIZE, UploadSessionService } from './upload-session.service';

@Controller('upload-sessions')
@UseGuards(JwtAuthGuard)
export class UploadSessionController {
  constructor(private readonly sessions: UploadSessionService) {}

  @Post()
  create(@CurrentUser() user: Express.User, @Body() request: CreateUploadSessionDto) {
    return this.sessions.create(user.id, request.files);
  }

  @Put(':uploadId/files/:fileIndex/chunks/:chunkIndex')
  @UseInterceptors(
    FileInterceptor('chunk', {
      storage: memoryStorage(),
      // Multer rejects a file as soon as it reaches the configured limit.
      limits: { fileSize: UPLOAD_CHUNK_SIZE + 1, files: 1, fields: 0 },
    }),
  )
  putChunk(
    @CurrentUser() user: Express.User,
    @Param('uploadId', ParseUUIDPipe) uploadId: string,
    @Param('fileIndex', ParseIntPipe) fileIndex: number,
    @Param('chunkIndex', ParseIntPipe) chunkIndex: number,
    @UploadedFile() chunk?: Express.Multer.File,
  ) {
    if (!chunk) throw new BadRequestException('An upload chunk is required');
    return this.sessions.putChunk(user.id, uploadId, fileIndex, chunkIndex, chunk.buffer);
  }

  @Delete(':uploadId')
  @HttpCode(204)
  cancel(@CurrentUser() user: Express.User, @Param('uploadId', ParseUUIDPipe) uploadId: string) {
    return this.sessions.cancel(user.id, uploadId);
  }
}
