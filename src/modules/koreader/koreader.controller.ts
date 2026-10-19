import {
  ArgumentsHost,
  Body,
  Catch,
  Controller,
  Delete,
  ExceptionFilter,
  Get,
  HttpCode,
  HttpException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { KoreaderAuthService, SyncActor } from './koreader-auth.service';
import { KoreaderDeviceGuard, KoreaderSyncGuard, SyncRequest } from './koreader.guard';
import { KoreaderService } from './koreader.service';
import { KoreaderDocumentService } from './koreader-document.service';
import { uuid } from './koreader-validation';

@Catch(HttpException)
export class KoreaderProtocolFilter implements ExceptionFilter {
  catch(error: HttpException, host: ArgumentsHost) {
    const originalStatus = error.getStatus();
    const status = originalStatus === 400 ? 403 : originalStatus;
    const code = status === 401 ? 2001 : status === 402 ? 2005 : status === 403 ? 2003 : 2000;
    host.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    host.switchToHttp().getResponse<Response>().status(status).json({ code, message: error.message });
  }
}

@Injectable()
export class KoreaderPrivateResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    context.switchToHttp().getResponse<Response>().setHeader('Cache-Control', 'no-store');
    return next.handle();
  }
}

function actor(request: SyncRequest): SyncActor {
  return request.syncActor!;
}
function browser(request: Request): SyncActor {
  return request.user!;
}
function ip(request: Request): string {
  return request.ip ?? request.socket.remoteAddress ?? 'unknown';
}

@Controller('koreader')
@UseInterceptors(KoreaderPrivateResponseInterceptor)
export class KoreaderPairingController {
  constructor(private readonly auth: KoreaderAuthService) {}

  @Post('pairings')
  @HttpCode(200)
  pair(@Body() body: unknown, @Req() request: Request) {
    return this.auth.createPairing(body, ip(request));
  }

  @Post('pairings/claim')
  @HttpCode(200)
  claim(@Body() body: unknown, @Req() request: Request) {
    return this.auth.claim(body, ip(request));
  }

  @Post('pairings/approve')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  approve(@Body() body: unknown, @Req() request: Request) {
    return this.auth.approve(body, browser(request));
  }

  @Get('devices')
  @UseGuards(JwtAuthGuard)
  devices(@Req() request: Request) {
    return this.auth.devices(browser(request));
  }

  @Delete('devices/:id')
  @HttpCode(204)
  @UseGuards(KoreaderSyncGuard)
  async revoke(@Param('id') id: string, @Req() request: SyncRequest) {
    const user = actor(request);
    if (user.deviceId && user.deviceId !== uuid(id)) throw new HttpException('Device unavailable', 404);
    await this.auth.revoke(user, uuid(id));
  }
}

@Controller('koreader')
@UseFilters(KoreaderProtocolFilter)
@UseInterceptors(KoreaderPrivateResponseInterceptor)
export class KoreaderNativeController {
  constructor(
    private readonly service: KoreaderService,
    private readonly auth: KoreaderAuthService,
  ) {}

  @Get('healthcheck')
  health() {
    return { state: 'OK' };
  }

  @Post('users/create')
  create(): never {
    throw new HttpException('User registration is disabled. Pair this reader in Homebranch settings.', 402);
  }

  @Get('users/auth')
  @UseGuards(KoreaderDeviceGuard)
  authenticate(@Req() request: SyncRequest) {
    return this.service.authenticated(actor(request));
  }

  @Put('syncs/progress')
  @UseGuards(KoreaderDeviceGuard)
  putProgress(@Req() request: SyncRequest, @Body() body: unknown) {
    return this.service.putNativeProgress(actor(request), body);
  }

  @Get('syncs/progress/:document')
  @UseGuards(KoreaderDeviceGuard)
  progress(@Req() request: SyncRequest, @Param('document') document: string) {
    return this.service.getNativeProgress(actor(request), document);
  }

  @Delete('users/me')
  @UseGuards(KoreaderDeviceGuard)
  async deleteBinding(@Req() request: SyncRequest) {
    await this.auth.revoke(actor(request), actor(request).deviceId!);
    return { deleted: true };
  }

  @Put('users/password')
  @UseGuards(KoreaderDeviceGuard)
  password(): never {
    throw new HttpException('Device password changes are unsupported. Revoke and pair again.', 403);
  }
}

@Controller('koreader')
@UseInterceptors(KoreaderPrivateResponseInterceptor)
export class KoreaderExtensionController {
  constructor(
    private readonly service: KoreaderService,
    private readonly documents: KoreaderDocumentService,
  ) {}

  @Post('documents/resolve')
  @HttpCode(200)
  @UseGuards(KoreaderDeviceGuard)
  resolve(@Req() request: SyncRequest, @Body() body: unknown) {
    return this.documents.resolve(actor(request), body);
  }

  @Get('books/:bookId/progress')
  @UseGuards(KoreaderSyncGuard)
  async progress(@Req() request: SyncRequest, @Param('bookId') bookId: string, @Res() response: Response) {
    response.json(await this.service.progress(actor(request), uuid(bookId)));
  }

  @Get('books/:bookId/annotations')
  @UseGuards(KoreaderSyncGuard)
  annotations(@Req() request: SyncRequest, @Param('bookId') bookId: string, @Query('after') after?: string) {
    return this.service.annotations(actor(request), uuid(bookId), after);
  }

  @Put('books/:bookId/annotations/:id')
  @UseGuards(KoreaderSyncGuard)
  putAnnotation(
    @Req() request: SyncRequest,
    @Param('bookId') bookId: string,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.putAnnotation(actor(request), uuid(bookId), id, body);
  }
}
