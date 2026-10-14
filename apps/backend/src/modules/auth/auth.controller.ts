import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// Part 4: API Specification - Auth endpoints

@Controller('auth')
// Blunt credential brute-force / registration abuse: 10 auth attempts per
// minute per IP across login + register + refresh.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private authService: AuthService) {}

  // PD-R3 (public-demo audit): registration gets its own long-window budget —
  // 3/hour/IP — so one IP cannot mass-create tenant accounts (each one is GLM
  // + storage quota). Overrides the class-wide 10/min for this method only.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refreshTokens(dto);
  }
}
