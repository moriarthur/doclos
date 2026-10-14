import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '../auth.service';

// Part 4: API Specification - JWT Authentication
// Part 7: Security & GDPR - JWT access token: 15min
//
// PD-A1 (public-demo audit): the browser authenticates via the HttpOnly
// access_token cookie; the Authorization header stays for direct API clients.

const cookieExtractor = (req: { cookies?: Record<string, string> }): string | null =>
  req?.cookies?.['access_token'] ?? null;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private authService: AuthService,
    configService: ConfigService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
    });
  }

  async validate(payload: { sub: string; type?: string }) {
    // P0-3 (audit): refresh tokens must not authenticate API routes
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }
    const user = await this.authService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }
}
