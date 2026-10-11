import { tenantScope } from 'src/common/utils/cloud';
import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { PaginatedQuery } from 'src/common/core/paginated-query';
import { CreateBookShelfDto } from 'src/modules/book-shelf/dto/create-book-shelf.dto';
import { UpdateBookShelfDto } from 'src/modules/book-shelf/dto/update-book-shelf.dto';
import { AddBookToBookShelfDto } from 'src/modules/book-shelf/dto/add-book-to-book-shelf.dto';
import { RemoveBookFromBookShelfDto } from 'src/modules/book-shelf/dto/remove-book-from-book-shelf.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { BookShelfService } from 'src/modules/book-shelf/book-shelf.service';

@Controller('book-shelves')
export class BookShelfController {
  constructor(private readonly bookShelfService: BookShelfService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getBookShelves(@CurrentUser() currentUser: Express.User, @Query() paginationDto: PaginatedQuery) {
    return this.bookShelfService.getBookShelves(paginationDto.limit, paginationDto.offset, currentUser.id);
  }

  @Get('by-book/:bookId')
  @UseGuards(JwtAuthGuard)
  getBookShelvesByBook(@CurrentUser() currentUser: Express.User, @Param('bookId') bookId: string) {
    return this.bookShelfService.getBookShelvesByBook(bookId, tenantScope(currentUser));
  }

  @Get(`:id/books`)
  @UseGuards(JwtAuthGuard)
  getBookShelfBooksById(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Query() paginationDto: PaginatedQuery,
  ) {
    return this.bookShelfService.getBookShelfBooks(
      id,
      tenantScope(currentUser),
      paginationDto.limit,
      paginationDto.offset,
      paginationDto.query,
    );
  }

  @Get(`:id`)
  @UseGuards(JwtAuthGuard)
  getBookShelfById(@CurrentUser() currentUser: Express.User, @Param('id') id: string) {
    return this.bookShelfService.getBookShelfById(id, tenantScope(currentUser));
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  createBookShelf(
    @CurrentUser() currentUser: Express.User,
    @Body()
    createBookShelfDto: CreateBookShelfDto,
  ) {
    return this.bookShelfService.createBookShelf(createBookShelfDto.title, currentUser.id);
  }

  @Delete(`:id`)
  @UseGuards(JwtAuthGuard)
  deleteBookShelf(@CurrentUser() currentUser: Express.User, @Param('id') id: string) {
    return this.bookShelfService.deleteBookShelf(id, tenantScope(currentUser));
  }

  @Put(`:id`)
  @UseGuards(JwtAuthGuard)
  updateBookShelf(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Body() updateBookShelfDto: UpdateBookShelfDto,
  ) {
    return this.bookShelfService.updateBookShelf(id, updateBookShelfDto.title, tenantScope(currentUser));
  }

  @Put(`:id/add-book`)
  @UseGuards(JwtAuthGuard)
  addBookToBookShelf(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Body() addBookToBookShelfDto: AddBookToBookShelfDto,
  ) {
    return this.bookShelfService.addBookToBookShelf(id, addBookToBookShelfDto.bookId, tenantScope(currentUser));
  }

  @Put(`:id/remove-book`)
  @UseGuards(JwtAuthGuard)
  removeBookFromBookShelf(
    @CurrentUser() currentUser: Express.User,
    @Param('id') id: string,
    @Body() removeBookFromBookShelfDto: RemoveBookFromBookShelfDto,
  ) {
    return this.bookShelfService.removeBookFromBookShelf(
      id,
      removeBookFromBookShelfDto.bookId,
      tenantScope(currentUser),
    );
  }
}
