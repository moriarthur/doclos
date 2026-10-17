import { ForbiddenException } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

// PD-A3: double-submit CSRF — state-changing requests must echo the
// csrf_token cookie in the X-CSRF-Token header.
describe('CsrfGuard', () => {
  const makeCtx = (method: string, cookie?: string, header?: string) => ({
    switchToHttp: () => ({
      getRequest: () => ({
        method,
        cookies: cookie === undefined ? {} : { csrf_token: cookie },
        headers: header === undefined ? {} : { 'x-csrf-token': header },
      }),
    }),
  }) as unknown as Parameters<CsrfGuard['canActivate']>[0];

  const guard = new CsrfGuard();

  it('allows safe methods without any token', () => {
    expect(guard.canActivate(makeCtx('GET'))).toBe(true);
    expect(guard.canActivate(makeCtx('HEAD'))).toBe(true);
    expect(guard.canActivate(makeCtx('OPTIONS'))).toBe(true);
  });

  it('rejects a POST with no cookie and no header', () => {
    expect(() => guard.canActivate(makeCtx('POST'))).toThrow(ForbiddenException);
  });

  it('rejects a POST with a cookie but no header', () => {
    expect(() => guard.canActivate(makeCtx('POST', 'tok'))).toThrow(ForbiddenException);
  });

  it('rejects a POST with a header that does not match the cookie', () => {
    expect(() => guard.canActivate(makeCtx('PATCH', 'tok', 'other'))).toThrow(ForbiddenException);
  });

  it('allows a state-changing request whose header echoes the cookie', () => {
    expect(guard.canActivate(makeCtx('POST', 'tok', 'tok'))).toBe(true);
    expect(guard.canActivate(makeCtx('DELETE', 'tok', 'tok'))).toBe(true);
  });
});
