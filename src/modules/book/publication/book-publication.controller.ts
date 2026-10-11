import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { tenantScope } from 'src/common/utils/cloud';
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { IsOptional } from 'class-validator';
import { BookFormatType } from 'src/modules/book/format/book-format-type.enum';
import { BookPublicationService } from 'src/modules/book/publication/book-publication.service';
import { buildExternalBaseUrl } from 'src/common/utils/external-url';
import { BookService } from 'src/modules/book/catalog/book.service';
import { basename } from 'path';
import { getBookFormatExtension, getBookFormatMediaType } from 'src/modules/book/format/book-format';
import { IStorageService, STORAGE_SERVICE_TOKEN } from 'src/modules/storage/storage.interface';
import { StorageStreamResult } from 'src/modules/storage/storage.types';

interface ByteRange {
  start: number;
  end: number;
}

function parseByteRange(header: string, size: number): ByteRange | undefined {
  if (size <= 0) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return undefined;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return undefined;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return undefined;
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}

class BookFormatQueryDto {
  @IsOptional()
  format?: BookFormatType;

  @IsOptional()
  inline?: string;
}

@Controller('books')
export class BookPublicationController {
  constructor(
    private readonly bookPublicationService: BookPublicationService,
    private readonly bookService: BookService,
    @Inject(STORAGE_SERVICE_TOKEN) private readonly storage: IStorageService,
  ) {}

  @Get(':id/manifest')
  @UseGuards(JwtAuthGuard)
  async getBookManifest(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Query() query: BookFormatQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<object | void> {
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    const baseUrl = buildExternalBaseUrl(req, { includeForwardedPrefix: true });
    const result = await this.bookPublicationService.getManifest(id, baseUrl, query.format);
    response.setHeader('Content-Type', 'application/webpub+json');
    return result;
  }

  @Get(':id/content/*path')
  @UseGuards(JwtAuthGuard)
  async getBookContent(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Param('path') path: string[],
    @Query() query: BookFormatQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    const entryPath = path.map(decodeURIComponent).join('/');
    const { data, mediaType } = await this.bookPublicationService.getContent(id, entryPath, query.format);
    response.setHeader('Content-Type', mediaType);
    response.setHeader('Cache-Control', 'private, max-age=3600');
    response.send(data);
  }

  @Get(':id/download')
  @UseGuards(JwtAuthGuard)
  async downloadBook(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Query() query: BookFormatQueryDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile | void> {
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    const { book, format, fileName } = await this.bookService.getDownload(id, query.format);
    const sanitizedTitle = book.title.replace(/[^\w\s-]/g, '').trim() || 'book';
    const safeFileName = basename(fileName);
    let storageStreamResult: StorageStreamResult;
    try {
      const fileKey = `books/${safeFileName}`;
      const rangeHeader = req.headers.range;
      if (rangeHeader) {
        const { size } = await this.storage.getFileStats(fileKey);
        const range = parseByteRange(rangeHeader, size);
        if (!range) {
          response.setHeader('Content-Range', `bytes */${size}`);
          response.status(416).end();
          return;
        }
        storageStreamResult = await this.storage.getFileStream(fileKey, range);
        response.status(206);
        response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`);
        response.setHeader('Content-Length', String(range.end - range.start + 1));
      } else {
        storageStreamResult = await this.storage.getFileStream(fileKey);
        response.setHeader('Content-Length', String(storageStreamResult.size));
      }
      response.setHeader('Accept-Ranges', 'bytes');
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        throw error;
      }
      response
        .status(404)
        .json({ success: false, error: 'BOOK_FILE_NOT_FOUND', message: 'Book file not found on server' });
      return;
    }

    return new StreamableFile(storageStreamResult.stream, {
      type: getBookFormatMediaType(format),
      length: req.headers.range ? undefined : storageStreamResult.size,
      disposition: `${query.inline === 'true' ? 'inline' : 'attachment'}; filename="${sanitizedTitle}${getBookFormatExtension(
        format,
      )}"`,
    });
  }
}
