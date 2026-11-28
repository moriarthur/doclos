// MF-1 regression tests — the duplicate-registration race in
// AuthService.register(). The findOne existence guard is not atomic: two
// concurrent registrations can both pass it, and the loser's INSERT dies on
// the users.email unique constraint (pg 23505, constraint
// UQ_97672ac88f789774dd47f7c8be3). Only a real Postgres produces that genuine
// error shape — which is exactly what the catch path must absorb into the
// uniform PD-A4 response instead of surfacing a 500.
//
// Race simulation without flakiness: the row is pre-inserted directly via the
// repository (bypassing the service), then findOne is stubbed to return null
// once — the guard's view inside the race window — so register() proceeds to
// the doomed INSERT against the real migrated schema.
//
// Runs only when TEST_DATABASE_URL points at a throwaway database (migrations
// are applied automatically, the baseline is idempotent). Without the variable
// the whole suite self-skips, so plain `pnpm test` stays green everywhere.
import { DataSource, DataSourceOptions, QueryRunner, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { dataSourceOptions } from '../../database/data-source';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { AuthService, REGISTER_SUCCESS_MESSAGE } from './auth.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DATABASE_URL ? describe : describe.skip;

d('AuthService.register (integration, MF-1 race)', () => {
  let ds: DataSource;
  // Holds the advisory lock for the whole suite — see beforeAll.
  let lockRunner: QueryRunner;
  let users: Repository<User>;
  let service: AuthService;
  const createdEmails: string[] = [];

  const raceEmail = (tag: string) =>
    `mf1-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const options = {
      ...dataSourceOptions,
      host: url.hostname,
      port: Number(url.port) || 5432,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ssl: false,
    } as DataSourceOptions;
    ds = new DataSource(options);
    await ds.initialize();
    // Serialize the DB integration suites — jest runs spec files in parallel
    // workers against this one database, and runMigrations must not
    // interleave. Same lock key as the other integration suites; a crashed
    // worker releases it implicitly by disconnecting. The lock rides a
    // dedicated query runner so acquire and unlock use the SAME pooled
    // connection.
    lockRunner = ds.createQueryRunner();
    await lockRunner.query(`SELECT pg_advisory_lock(hashtext('doclos-backend-integration'))`);
    await ds.runMigrations(); // idempotent — the baseline skips applied steps
    users = ds.getRepository(User);
    // register() touches only usersRepository (+ bcrypt); the JWT side of the
    // service is covered by the unit suite, so the unused deps are stubbed.
    service = new AuthService(
      users,
      {} as unknown as Repository<RefreshSession>,
      {} as unknown as JwtService,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    // Leave the throwaway DB as this suite found it.
    for (const email of createdEmails.splice(0)) {
      await users?.delete({ email });
    }
    await lockRunner?.query(`SELECT pg_advisory_unlock(hashtext('doclos-backend-integration'))`);
    await lockRunner?.release();
    await ds?.destroy();
  });

  it('a registration that loses the race answers the uniform body, not the 23505', async () => {
    // The "concurrent winner": already committed through the repository,
    // bypassing register() entirely.
    const email = raceEmail('race');
    createdEmails.push(email);
    await users.save({ email, password_hash: 'x', name: 'MF-1 winner' });

    // The register() guard looks exactly once — and inside the race window it
    // misses the committed row, so register() proceeds to the doomed INSERT.
    // Without the MF-1 catch, the save below rejects with the genuine
    // QueryFailedError (23505) and this test would fail on it.
    const findOneSpy = jest.spyOn(users, 'findOne').mockResolvedValueOnce(null);

    const result = await service.register({
      // Uppercase on purpose: the normalized email must collide with the
      // seeded row's constraint, proving the real UQ_… constraint is matched.
      email: email.toUpperCase(),
      password: 'long-enough-password',
      name: 'MF-1 loser',
    });
    expect(findOneSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ message: REGISTER_SUCCESS_MESSAGE });

    // Exactly one row exists — the loser inserted nothing.
    expect(await users.countBy({ email })).toBe(1);
  });

  it('a fresh registration still inserts and answers the same uniform body', async () => {
    const email = raceEmail('fresh');
    createdEmails.push(email);

    const result = await service.register({
      email,
      password: 'long-enough-password',
      name: 'MF-1 fresh',
    });

    expect(result).toEqual({ message: REGISTER_SUCCESS_MESSAGE });
    const saved = await users.findOneByOrFail({ email });
    // The bcrypt hash is stored, not the raw password — the real insert ran.
    expect(saved.password_hash).not.toBe('long-enough-password');
    expect(saved.name).toBe('MF-1 fresh');
  });
});
