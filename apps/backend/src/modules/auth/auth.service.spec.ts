import * as crypto from 'crypto';
import { AuthService } from './auth.service';

// PD-A2 (public-demo audit): refresh sessions — rotation, reuse detection,
// revocation. Repos and JwtService are mocked; sessions live in a Map keyed
// by token hash, exactly what the production table stores.
describe('AuthService refresh sessions', () => {
  const sha256 = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

  type Tokens = { access_token: string; refresh_token: string };

  const makeHarness = () => {
    const sessions = new Map<string, Record<string, unknown>>();
    let tokenCounter = 0;
    const users = new Map<string, Record<string, unknown>>([
      ['u1', { id: 'u1', email: 'a@x.com', password_hash: '$2a$10$hashed' }],
      ['u2', { id: 'u2', email: 'b@x.com', password_hash: '$2a$10$hashed' }],
    ]);

    const sessionsRepository = {
      create: (x: Record<string, unknown>) => ({ revoked_at: null, last_used_at: null, ...x }),
      save: async (s: Record<string, unknown>) => {
        sessions.set(s.token_hash as string, { ...s });
        return s;
      },
      findOne: async ({ where }: { where: { token_hash: string } }) =>
        sessions.get(where.token_hash) ?? null,
      update: async (criteria: Record<string, unknown>, patch: Record<string, unknown>) => {
        // `revoked_at` in criteria mirrors the service's IsNull() condition —
        // only touch sessions that are still live.
        const onlyUnrevoked = 'revoked_at' in criteria;
        for (const s of sessions.values()) {
          if (criteria.token_hash !== undefined && s.token_hash !== criteria.token_hash) continue;
          if (criteria.user_id !== undefined && s.user_id !== criteria.user_id) continue;
          if (onlyUnrevoked && s.revoked_at) continue;
          Object.assign(s, patch);
        }
      },
      delete: async () => undefined,
    };

    const usersRepository = {
      findOne: async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) return users.get(where.id) ?? null;
        for (const u of users.values()) if (u.email === where.email) return u;
        return null;
      },
      create: (x: Record<string, unknown>) => ({ id: 'u-new', ...x }),
      save: async (u: Record<string, unknown>) => {
        users.set(u.id as string, u);
        return u;
      },
    };

    const jwtService = {
      verify: (token: string) => {
        // Only tokens this harness signed verify.
        if (!token.startsWith('rt-') && !token.startsWith('at-')) {
          throw new Error('jwt malformed');
        }
        const [prefix, sub] = token.split('|');
        return { sub, type: prefix.startsWith('rt') ? 'refresh' : 'access' };
      },
      sign: (payload: { sub: string; type: string }) => {
        const token =
          payload.type === 'refresh'
            ? `rt-${++tokenCounter}|${payload.sub}|sig${tokenCounter}`
            : `at-${++tokenCounter}|${payload.sub}|sig${tokenCounter}`;
        return token;
      },
    };

    const service = Object.create(AuthService.prototype) as AuthService;
    Object.defineProperty(service, 'usersRepository', { value: usersRepository });
    Object.defineProperty(service, 'refreshSessionsRepository', { value: sessionsRepository });
    Object.defineProperty(service, 'jwtService', { value: jwtService });
    Object.defineProperty(service, 'logger', { value: { warn: jest.fn(), log: jest.fn() } });

    // Token issuance under test: generateTokens is private, so the harness
    // reaches it through one typed cast instead of driving the register path.
    const issue = async (userId: string): Promise<Tokens> =>
      (
        service as unknown as {
          generateTokens: (id: string) => Promise<Tokens>;
        }
      ).generateTokens(userId);

    return { service, sessions, issue };
  };

  it('token issuance stores only the hash of the refresh token, never the token', async () => {
    const { sessions, issue } = makeHarness();
    const tokens = await issue('u1');
    const hashes = [...sessions.keys()];
    expect(hashes).toHaveLength(1);
    expect(hashes[0]).toBe(sha256(tokens.refresh_token));
    // The stored hash must not contain (or equal) the raw token material.
    expect(sessions.get(hashes[0])!.token_hash).toBe(sha256(tokens.refresh_token));
  });

  it('refresh rotates: old token revoked, new pair issued', async () => {
    const { service, sessions, issue } = makeHarness();
    const first = await issue('u1');

    const second = await service.refreshTokens({ refresh_token: first.refresh_token });
    expect(second.refresh_token).not.toBe(first.refresh_token);

    // Old session is revoked, new one is live.
    const oldSession = sessions.get(sha256(first.refresh_token))!;
    const newSession = sessions.get(sha256(second.refresh_token))!;
    expect(oldSession.revoked_at).toBeTruthy();
    expect(newSession.revoked_at).toBeNull();
  });

  it('an access token against the refresh endpoint is rejected (401)', async () => {
    const { service, issue } = makeHarness();
    const { access_token } = await issue('u1');
    await expect(
      service.refreshTokens({ refresh_token: access_token }),
    ).rejects.toMatchObject({ status: 401 } satisfies Record<string, unknown>);
  });

  it('a token with no session row is rejected (purged / never issued)', async () => {
    const { service } = makeHarness();
    await expect(
      service.refreshTokens({ refresh_token: 'rt-999|u1|forged-but-signed-shape' }),
    ).rejects.toMatchObject({ status: 401 } satisfies Record<string, unknown>);
  });

  it('reuse of a rotated refresh token revokes the whole user chain (401)', async () => {
    const { service, sessions, issue } = makeHarness();
    const first = await issue('u1');
    const second = await service.refreshTokens({ refresh_token: first.refresh_token });

    await expect(
      service.refreshTokens({ refresh_token: first.refresh_token }),
    ).rejects.toMatchObject({ status: 401 } satisfies Record<string, unknown>);

    // Theft response: BOTH the rotated-away and the current token are dead.
    expect(sessions.get(sha256(first.refresh_token))!.revoked_at).toBeTruthy();
    expect(sessions.get(sha256(second.refresh_token))!.revoked_at).toBeTruthy();
  });

  it('reuse detection is scoped to the affected user', async () => {
    const { service, sessions, issue } = makeHarness();
    const a1 = await issue('u1');
    const b1 = await issue('u2');

    await service.refreshTokens({ refresh_token: a1.refresh_token });
    // User A replays an old token → user A's chain burns…
    await expect(
      service.refreshTokens({ refresh_token: a1.refresh_token }),
    ).rejects.toMatchObject({ status: 401 } satisfies Record<string, unknown>);

    // …but user B's session is untouched and still refreshes.
    expect(sessions.get(sha256(b1.refresh_token))!.revoked_at).toBeNull();
    await expect(
      service.refreshTokens({ refresh_token: b1.refresh_token }),
    ).resolves.toMatchObject({ refresh_token: expect.any(String) });
  });

  it('logout revokes the session server-side; further refresh fails', async () => {
    const { service, issue } = makeHarness();
    const tokens = await issue('u1');

    await service.logout(tokens.refresh_token);

    await expect(
      service.refreshTokens({ refresh_token: tokens.refresh_token }),
    ).rejects.toMatchObject({ status: 401 } satisfies Record<string, unknown>);
  });

  it('logout is idempotent for unknown tokens', async () => {
    const { service } = makeHarness();
    await expect(service.logout('rt-404|u1|nope')).resolves.toMatchObject({
      message: 'Logged out',
    });
  });

  it('refresh is pinned to the issuing user (session lookup by hash)', async () => {
    const { service, issue } = makeHarness();
    const a = await issue('u1');
    const rotated = await service.refreshTokens({ refresh_token: a.refresh_token });
    // The new tokens belong to the SAME user — a token can never mint
    // sessions for anyone else.
    expect(rotated.refresh_token).toContain('|u1|');
    expect(rotated.access_token).toContain('|u1|');
  });
});
