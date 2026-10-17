import { resolvePort } from './resolve-port';

// PD-DEP1: Render injects PORT; local dev keeps APP_PORT.
describe('resolvePort', () => {
  it('prefers PORT over APP_PORT', () => {
    expect(resolvePort({ PORT: '10000', APP_PORT: '3001' })).toBe(10000);
  });

  it('falls back to APP_PORT when PORT is absent', () => {
    expect(resolvePort({ APP_PORT: '3001' })).toBe(3001);
  });

  it('defaults to 3001 with neither set', () => {
    expect(resolvePort({})).toBe(3001);
  });

  it('ignores non-numeric PORT and uses APP_PORT', () => {
    expect(resolvePort({ PORT: 'not-a-port', APP_PORT: '3001' })).toBe(3001);
  });

  it('rejects out-of-range ports', () => {
    expect(() => resolvePort({ PORT: '70000' })).toThrow(/Invalid port/);
    expect(() => resolvePort({ PORT: '-1' })).toThrow(/Invalid port/);
  });
});
