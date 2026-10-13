import { Body, Controller, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { tenantScope } from 'src/common/utils/cloud';
import { UpdateKindleEmailDto } from 'src/modules/kindle/dto/update-kindle-email.dto';
import { KindleService } from 'src/modules/kindle/kindle.service';

@Controller()
@UseGuards(JwtAuthGuard)
export class KindleController {
  constructor(private readonly kindleService: KindleService) {}

  @Get('kindle/email')
  async getKindleEmail(@CurrentUser() user: Express.User) {
    return { kindleEmail: await this.kindleService.getKindleEmail(user.id) };
  }

  @Put('kindle/email')
  async setKindleEmail(@CurrentUser() user: Express.User, @Body() dto: UpdateKindleEmailDto) {
    return { kindleEmail: await this.kindleService.setKindleEmail(user.id, dto.kindleEmail ?? null) };
  }

  @Post('books/:id/send-to-kindle')
  @HttpCode(200)
  async sendToKindle(@CurrentUser() user: Express.User, @Param('id') id: string) {
    await this.kindleService.sendBook(user.id, id, tenantScope(user));
    return { success: true };
  }
}
