import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

// PD-A3 (public-demo audit): double-submit CSRF protection for the
// cookie-based auth transport. The csrf_token cookie is deliberately NOT
// HttpOnly (the browser must echo it in a header); a cross-site attacker can
// send cookies but cannot READ them, so they cannot produce the matching
// X-CSRF-Token header. SameSite=Lax cookies back this up.
//
// Registered as the second APP_GUARD (after RateLimitGuard, before route
// guards): rate limiting sees abusive floods first, CSRF runs before auth.
@Injectable()
export class CsrfGuard implements CanActivate {
  private static readonly CSRF_COOKIE = 'csrf_token';
  private static readonly CSRF_HEADER = 'x-csrf-token';

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    const cookieToken: string | undefined = request.cookies?.[CsrfGuard.CSRF_COOKIE];
    const headerToken: string | undefined = request.headers[CsrfGuard.CSRF_HEADER];
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new ForbiddenException('CSRF token missing or invalid');
    }
    return true;
  }
}
