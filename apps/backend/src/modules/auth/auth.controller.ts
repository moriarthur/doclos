import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Request as NestRequest,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AuthService, parseDurationMs } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

// cookie-parser adds req.cookies at runtime; the express Request type
// doesn't model it without the augmentation — one narrow cast instead.
type RequestWithCookies = Request & { cookies?: Record<string, string | undefined> };

const readCookie = (req: Request, name: string): string | undefined =>
  (req as RequestWithCookies).cookies?.[name];

// Part 4: API Specification - Auth endpoints
//
// PD-A1 (public-demo audit): tokens are HttpOnly cookies now — the browser
// never sees token material (no localStorage, no JS-readable cookies), so an
// XSS cannot exfiltrate a 30-day refresh token. The Bearer header remains
// accepted for API clients (smoke tests, scripts); it is no longer issued to
// browsers. PD-A3: state-changing requests additionally require the
// double-submit CSRF header (see CsrfGuard).

const ACCESS_COOKIE = 'access_token';
const REFRESH_COOKIE = 'refresh_token';
const CSRF_COOKIE = 'csrf_token';

@Controller('auth')
// Blunt credential brute-force / registration abuse: 10 auth attempts per
// minute per IP across login + register + refresh.
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(private authService: AuthService) {}

  private cookieBase() {
    const isProduction = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
    };
  }

  private setAuthCookies(res: Response, tokens: { access_token: string; refresh_token: string }) {
    const base = this.cookieBase();
    const accessTtlMs = parseDurationMs(process.env.JWT_ACCESS_EXPIRATION || '15m');
    const refreshTtlMs = parseDurationMs(process.env.JWT_REFRESH_EXPIRATION || '30d');
    // Refresh cookie is scoped to the auth routes — it never rides normal
    // API calls, shrinking the blast radius of any future path confusion.
    res.cookie(ACCESS_COOKIE, tokens.access_token, {
      ...base,
      maxAge: accessTtlMs,
      path: '/',
    });
    res.cookie(REFRESH_COOKIE, tokens.refresh_token, {
      ...base,
      maxAge: refreshTtlMs,
      path: '/api/v1/auth',
    });
  }

  private clearAuthCookies(res: Response) {
    const base = this.cookieBase();
    res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/v1/auth' });
  }

  private setCsrfCookie(res: Response): string {
    const isProduction = process.env.NODE_ENV === 'production';
    const token = crypto.randomBytes(32).toString('hex');
    // NOT httpOnly: double-submit requires the browser JS to echo it in a
    // header. It is not a credential — leaking it alone grants nothing.
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 24 * 3_600_000,
      path: '/',
    });
    return token;
  }

  /**
   * CSRF bootstrap: the frontend calls this once on app load; the double-submit
   * cookie is set and echoed in the body for direct API clients.
   */
  @Get('csrf')
  csrf(@Res({ passthrough: true }) res: Response) {
    const csrfToken = this.setCsrfCookie(res);
    return { csrfToken };
  }

  // PD-R3 (public-demo audit): registration gets its own long-window budget —
  // 3/hour/IP — so one IP cannot mass-create tenant accounts (each one is GLM
  // + storage quota). Overrides the class-wide 10/min for this method only.
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.register(dto);
    this.setAuthCookies(res, tokens);
    this.setCsrfCookie(res);
    // PD-A1: token material is cookie-only — the body carries no tokens.
    return { user_id: tokens.user_id };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.login(dto);
    this.setAuthCookies(res, tokens);
    this.setCsrfCookie(res);
    return { user_id: tokens.user_id };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() dto: RefreshTokenDto,
    @NestRequest() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    // PD-A1: the browser presents the refresh token via the HttpOnly cookie;
    // scripts may still POST it in the body.
    const token = readCookie(req, REFRESH_COOKIE) || dto.refresh_token;
    const tokens = await this.authService.refreshTokens({ refresh_token: token });
    this.setAuthCookies(res, tokens);
    return { message: 'refreshed' };
  }

  // PD-A2: server-side logout — revokes the refresh session so the token is
  // dead even if a copy was exfiltrated. Idempotent by design.
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Body() dto: RefreshTokenDto,
    @NestRequest() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = readCookie(req, REFRESH_COOKIE) || dto.refresh_token;
    const result = await this.authService.logout(token);
    this.clearAuthCookies(res);
    return result;
  }
}
