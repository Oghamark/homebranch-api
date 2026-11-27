import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { Roles } from 'src/common/guards/roles.decorator';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { accessCredential } from 'src/modules/auth/account-directory.gateway';
import { BulkBooksDto, BulkOwnerDto, BulkShelfDto } from './bulk-book.dto';
import { BulkBookService } from './bulk-book.service';

@Controller('books/bulk')
@UseGuards(JwtAuthGuard)
export class BulkBookController {
  constructor(private readonly bulk: BulkBookService) {}

  @Post('delete')
  delete(@Body() dto: BulkBooksDto, @CurrentUser() user: Express.User) {
    return this.bulk.delete(dto.bookIds, user);
  }

  @Post('favorite')
  favorite(@Body() dto: BulkBooksDto, @CurrentUser() user: Express.User) {
    return this.bulk.favorite(dto.bookIds, user, true);
  }

  @Post('unfavorite')
  unfavorite(@Body() dto: BulkBooksDto, @CurrentUser() user: Express.User) {
    return this.bulk.favorite(dto.bookIds, user, false);
  }

  @Post('add-to-shelf')
  addToShelf(@Body() dto: BulkShelfDto, @CurrentUser() user: Express.User) {
    return this.bulk.shelf(dto.bookIds, dto.shelfId, user, true);
  }

  @Post('remove-from-shelf')
  removeFromShelf(@Body() dto: BulkShelfDto, @CurrentUser() user: Express.User) {
    return this.bulk.shelf(dto.bookIds, dto.shelfId, user, false);
  }

  @Post('assign-owner')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  assignOwner(@Body() dto: BulkOwnerDto, @CurrentUser() user: Express.User, @Req() request: Request) {
    return this.bulk.assignOwner(
      dto.bookIds,
      dto.ownerId,
      user,
      dto.ownerId === null ? undefined : accessCredential(request),
    );
  }
}
