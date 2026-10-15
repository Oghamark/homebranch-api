import { tenantScope } from 'src/common/utils/cloud';
import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  BadRequestException,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CreateBookRequest } from 'src/modules/book/dto/create-book-request';
import { UpdateBookRequest } from 'src/modules/book/dto/update-book-request';
import { GetBooksRequest } from 'src/modules/book/dto/get-books-request';
import { BookCreationService } from 'src/modules/book/catalog/book-creation.service';
import { BookMutationService } from 'src/modules/book/catalog/book-mutation.service';
import { BookService } from 'src/modules/book/catalog/book.service';
import { UpdateBookDto } from 'src/modules/book/dto/update-book.dto';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { basename, join } from 'path';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { tmpdir } from 'os';
import { existsSync, mkdirSync } from 'fs';
import { unlink } from 'fs-extra';

class AssignOwnerDto {
  @IsUUID()
  @IsOptional()
  userId: string | null;
}

class BulkAssignOwnerDto {
  @IsUUID(undefined, { each: true })
  bookIds: string[];

  @IsUUID()
  @IsOptional()
  userId: string | null;
}

class LinkBooksDto {
  @IsUUID()
  sourceBookId: string;
}

class AudiobookPreviewRequest {
  relativePaths: string;
}

class SelectBookCoverRequest {
  @IsInt()
  @Min(1)
  coverId: number;
}

@Controller('books')
export class BookController {
  private readonly logger: Logger = new Logger(BookController.name);

  constructor(
    private readonly bookService: BookService,
    private readonly bookCreationService: BookCreationService,
    private readonly bookMutationService: BookMutationService,
  ) {}
  @Get()
  @UseGuards(JwtAuthGuard)
  getBooks(@Query() paginationDto: GetBooksRequest, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Get books request received');
    return this.bookService.getBooks({
      ...paginationDto,
      userId: tenantScope(currentUser) ?? paginationDto.userId,
      viewerUserId: currentUser.id,
    });
  }

  @Get('favorite')
  @UseGuards(JwtAuthGuard)
  getFavoriteBooks(@Query() paginationDto: GetBooksRequest, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Get favorite books request received');
    return this.bookService.getFavoriteBooks({ ...paginationDto, userId: currentUser.id });
  }

  @Get('mine')
  @UseGuards(JwtAuthGuard)
  getCurrentUserBooks(@Query() paginationDto: GetBooksRequest, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Get current user books request received');
    return this.bookService.getCurrentUserBooks(paginationDto, currentUser.id);
  }

  @Get('genres')
  @UseGuards(JwtAuthGuard)
  getGenres(@CurrentUser() currentUser: Express.User) {
    return this.bookService.getGenres(tenantScope(currentUser));
  }

  @Put(':id/favorite')
  @UseGuards(JwtAuthGuard)
  async toggleFavorite(@Param('id') id: string, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Favorite book request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.toggleFavorite(currentUser.id, id);
  }

  @Get(':id/covers')
  @UseGuards(JwtAuthGuard)
  async searchBookCovers(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('query') query: string | undefined,
    @CurrentUser() currentUser: Express.User,
  ) {
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.searchBookCovers(id, query);
  }

  @Post(':id/cover')
  @UseGuards(JwtAuthGuard)
  async selectBookCover(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() request: SelectBookCoverRequest,
    @CurrentUser() currentUser: Express.User,
  ) {
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.selectBookCover(id, request.coverId);
  }

  @Get(`:id`)
  @UseGuards(JwtAuthGuard)
  getBookById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Get book by id request received');
    return this.bookService.getBookById(id, currentUser.id, tenantScope(currentUser));
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'file', maxCount: 1 },
        { name: 'coverImage', maxCount: 1 },
      ],
      {
        storage: diskStorage({
          destination: (_req, file, cb) => {
            let uploadPath: string | null = null;
            switch (file.fieldname) {
              case 'file':
                uploadPath = join(tmpdir(), 'uploads', 'incoming');
                break;
              case 'coverImage':
                uploadPath = join(tmpdir(), 'uploads', 'cover-images');
                break;
              default:
                // Invalid field name, no-op
                break;
            }
            if (!uploadPath) {
              return;
            }
            if (!existsSync(uploadPath)) {
              mkdirSync(uploadPath, { recursive: true });
            }

            cb(null, uploadPath);
          },
          filename: (_req, file, cb) => {
            switch (file.fieldname) {
              case 'file':
                cb(null, `${randomUUID()}-${file.originalname}`);
                break;
              case 'coverImage':
                cb(null, file.originalname);
                break;
              default:
                // Invalid field name, no-op
                break;
            }
          },
        }),
      },
    ),
  )
  async createBook(
    @CurrentUser() currentUser: Express.User,
    @UploadedFiles()
    files: {
      file?: Express.Multer.File[];
      coverImage?: Express.Multer.File[];
    },
    @Body()
    createBookRequest: CreateBookRequest,
  ) {
    try {
      this.logger.log('Uploading books: ' + JSON.stringify(files));
      if (!files.file) {
        throw new Error('No file uploaded');
      }
      return await this.bookCreationService.createBook({
        ...createBookRequest,
        filePath: files.file[0].path,
        coverImagePath: files.coverImage?.[0]?.path,
        uploadedByUserId: currentUser.id,
      });
    } catch (error) {
      this.logger.error('Failed to upload book:', error);
      throw error;
    } finally {
      // Storage moves the temp files, so they may already be gone
      await Promise.all(
        [files?.file?.[0]?.path, files?.coverImage?.[0]?.path]
          .filter((path): path is string => !!path)
          .map((path) => unlink(path).catch(() => {})),
      );
    }
  }

  @Post('audiobook/preview')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', 500, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(tmpdir(), 'uploads', 'audiobooks');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => cb(null, `${randomUUID()}-${basename(file.originalname)}`),
      }),
    }),
  )
  async previewAudiobook(@UploadedFiles() files: Express.Multer.File[], @Body() request: AudiobookPreviewRequest) {
    try {
      let relativePaths: unknown;
      try {
        relativePaths = JSON.parse(request.relativePaths);
      } catch {
        throw new BadRequestException('Invalid audiobook file paths');
      }
      if (!Array.isArray(relativePaths)) {
        throw new BadRequestException('Invalid audiobook file paths');
      }
      const validRelativePaths = relativePaths.filter((path): path is string => typeof path === 'string');
      if (validRelativePaths.length !== relativePaths.length) {
        throw new BadRequestException('Invalid audiobook file paths');
      }
      return await this.bookCreationService.previewAudiobook(files ?? [], validRelativePaths);
    } finally {
      await Promise.all((files ?? []).map((file) => unlink(file.path).catch(() => {})));
    }
  }

  @Post('audiobook')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(
    FilesInterceptor('files', 500, {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const uploadPath = join(tmpdir(), 'uploads', 'audiobooks');
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (_req, file, cb) => cb(null, `${randomUUID()}-${basename(file.originalname)}`),
      }),
    }),
  )
  async createAudiobook(
    @CurrentUser() currentUser: Express.User,
    @UploadedFiles() files: Express.Multer.File[],
    @Body() request: CreateBookRequest,
  ) {
    try {
      return await this.bookCreationService.createAudiobook(files ?? [], request.title, request.author, currentUser.id);
    } finally {
      await Promise.all((files ?? []).map((file) => unlink(file.path).catch(() => {})));
    }
  }

  @Delete(`:id`)
  @UseGuards(JwtAuthGuard)
  async deleteBook(@CurrentUser() currentUser: Express.User, @Param('id') id: string) {
    this.logger.log('Delete book request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.deleteBook(id, currentUser.id, currentUser.roles?.includes('ADMIN') ?? false);
  }

  @Patch('assign-owner')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  bulkAssignOwner(@Body() dto: BulkAssignOwnerDto, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Bulk assign owner request received');
    return this.bookService.bulkAssignBookOwner(dto.bookIds, dto.userId, currentUser.roles?.includes('ADMIN') ?? false);
  }

  @Patch(`:id/owner`)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  assignOwner(@Param('id') id: string, @Body() dto: AssignOwnerDto, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Assign book owner request received');
    return this.bookService.assignBookOwner(id, dto.userId, currentUser.roles?.includes('ADMIN') ?? false);
  }

  @Put(`:id`)
  @UseGuards(JwtAuthGuard)
  async updateBook(
    @Param('id') id: string,
    @Body() updateBookDto: UpdateBookDto,
    @CurrentUser() currentUser: Express.User,
  ) {
    this.logger.log('Update book request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    const updateBookRequest: UpdateBookRequest = {
      id,
      ...updateBookDto,
    };
    return this.bookMutationService.updateBook(updateBookRequest);
  }

  @Post(':id/link')
  @UseGuards(JwtAuthGuard)
  async linkBooks(@Param('id') id: string, @Body() dto: LinkBooksDto, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Link book formats request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    await this.bookService.assertAccess(dto.sourceBookId, tenantScope(currentUser));
    return this.bookMutationService.linkBooks({
      targetBookId: id,
      sourceBookId: dto.sourceBookId,
      requestingUserId: currentUser.id,
      requestingUserRole: currentUser.roles?.includes('ADMIN') ? 'ADMIN' : 'USER',
    });
  }

  @Delete(':id/formats/:formatId')
  @UseGuards(JwtAuthGuard)
  async unlinkBookFormat(
    @Param('id') id: string,
    @Param('formatId') formatId: string,
    @CurrentUser() currentUser: Express.User,
  ) {
    this.logger.log('Unling book format request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookMutationService.unlinkBookFormat({
      bookId: id,
      formatId,
      requestingUserId: currentUser.id,
      requestingUserRole: currentUser.roles?.includes('ADMIN') ? 'ADMIN' : 'USER',
    });
  }

  @Post(':id/fetch-metadata')
  @UseGuards(JwtAuthGuard)
  async fetchBookMetadata(@Param('id') id: string, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Fetch book metadata request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.fetchBookMetadata(id);
  }

  @Post(':id/fetch-summary')
  @UseGuards(JwtAuthGuard)
  async fetchBookSummary(@Param('id') id: string, @CurrentUser() currentUser: Express.User) {
    this.logger.log('Fetch book summary request received');
    await this.bookService.assertAccess(id, tenantScope(currentUser));
    return this.bookService.fetchBookSummary(id);
  }
}
