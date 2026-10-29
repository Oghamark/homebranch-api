import { Body, Controller, Delete, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { SavePositionDto } from 'src/modules/saved-position/dto/save-position.dto';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { SavedPositionService } from 'src/modules/saved-position/saved-position.service';

@Controller('users/:userId/saved-positions')
@UseGuards(JwtAuthGuard)
export class SavedPositionController {
  constructor(private readonly savedPositionService: SavedPositionService) {}

  @Get()
  getSavedPositions(@CurrentUser() currentUser: Express.User) {
    return this.savedPositionService.findAllByUser(currentUser.id);
  }

  @Get(':bookId')
  getSavedPosition(@CurrentUser() currentUser: Express.User, @Param('bookId') bookId: string) {
    return this.savedPositionService.findByBookAndUser(bookId, currentUser.id);
  }

  @Put(':bookId')
  savePosition(
    @CurrentUser() currentUser: Express.User,
    @Param('bookId') bookId: string,
    @Body() dto: SavePositionDto,
  ) {
    return this.savedPositionService.save({
      bookId,
      userId: currentUser.id,
      position: dto.position,
      deviceName: dto.deviceName,
      percentage: dto.percentage,
      ...(dto.location === undefined ? {} : { location: dto.location }),
    });
  }

  @Delete(':bookId')
  @HttpCode(204)
  deleteSavedPosition(@CurrentUser() currentUser: Express.User, @Param('bookId') bookId: string) {
    return this.savedPositionService.delete(bookId, currentUser.id);
  }
}
