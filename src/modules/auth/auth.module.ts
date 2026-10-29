import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { JwtStrategy } from 'src/modules/auth/strategies/jwt.strategy';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { JwtTokenGateway } from 'src/modules/auth/jwt-token.gateway';
import { HttpAuthGateway } from 'src/modules/auth/http-auth.gateway';
import { AccountDirectoryGateway } from './account-directory.gateway';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  providers: [JwtTokenGateway, HttpAuthGateway, AccountDirectoryGateway, JwtStrategy, JwtAuthGuard, RolesGuard],
  exports: [JwtTokenGateway, HttpAuthGateway, AccountDirectoryGateway, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
