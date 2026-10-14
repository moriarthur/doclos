import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { Document } from '../documents/entities/document.entity';
import { PendingStorageDeletion } from '../storage/entities/pending-storage-deletion.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, RefreshSession, Document, PendingStorageDeletion]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: configService.get<string>('JWT_ACCESS_EXPIRATION') || '15m' },
      }),
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [AuthService, JwtStrategy, AccountService],
  exports: [AuthService],
})
export class AuthModule {}
