// PD-D4 integration tests — the retention sweep's candidate selection against
// REAL Postgres with the real migrated schema. The production defect: the
// sweep filtered on `last_login < cutoff` only, and SQL `NULL < cutoff` is
// never true — an account that registered but never logged in (registration
// does not set last_login, auth.service.register) was invisible to every
// sweep and accumulated forever. The fix selects two OR'd candidate shapes:
// stale last_login, or last_login IS NULL with an old created_at.
// Only real SQL can prove the NULL branch — repository mocks cannot.
//
// Runs only when TEST_DATABASE_URL points at a throwaway database (migrations
// are applied automatically, the baseline is idempotent). Without the variable
// the whole suite self-skips, so plain `pnpm test` stays green everywhere.
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../../database/data-source';
import { User } from '../auth/entities/user.entity';
import { Document, DocumentStatus, DocumentType } from '../documents/entities/document.entity';
import { PendingStorageDeletion } from '../storage/entities/pending-storage-deletion.entity';
import { StorageCleanupService } from '../storage/services/storage-cleanup.service';
import { S3Service } from '../storage/services/s3.service';
import { AccountService } from '../auth/account.service';
import { DemoRetentionService } from './demo-retention.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DATABASE_URL ? describe : describe.skip;

d('DemoRetentionService.sweep (integration, PD-D4)', () => {
  let ds: DataSource;
  let lockRunner: QueryRunner;
  let sweep: () => Promise<number>;
  const survivors: string[] = []; // accounts a test intentionally keeps

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
    // Same session-level advisory lock as the other DB integration suites —
    // deleteAccount purges the SHARED pending_storage_deletions retry table,
    // so the suites must not interleave.
    lockRunner = ds.createQueryRunner();
    await lockRunner.query(`SELECT pg_advisory_lock(hashtext('doclos-backend-integration'))`);
    await ds.runMigrations(); // idempotent — the baseline skips applied steps
    await ds.getRepository(PendingStorageDeletion).clear();

    process.env.DEMO_RETENTION_DAYS = '14';

    const storageCleanup = new StorageCleanupService(
      ds.getRepository(PendingStorageDeletion),
      { deleteFile: jest.fn(async () => undefined) } as unknown as S3Service,
    );
    const accountService = new AccountService(
      ds.getRepository(User),
      ds.getRepository(Document),
      ds,
      storageCleanup,
    );
    const retention = new DemoRetentionService(
      ds.getRepository(User),
      accountService,
    );
    sweep = () => retention.sweep();
  });

  afterAll(async () => {
    delete process.env.DEMO_RETENTION_DAYS;
    await lockRunner?.query(`SELECT pg_advisory_unlock(hashtext('doclos-backend-integration'))`);
    await lockRunner?.release();
    await ds?.destroy();
  });

  async function seedUser(tag: string): Promise<string> {
    return (
      await ds.getRepository(User).save({
        email: `pdd4-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password_hash: 'x',
        name: 'PD-D4 IT',
      })
    ).id;
  }

  /** Backdate a column of one user via raw SQL — entity save() would set it to now(). */
  async function backdate(column: 'last_login' | 'created_at', userId: string, daysAgo: number) {
    await ds.query(`UPDATE users SET ${column} = $1 WHERE id = $2`, [
      new Date(Date.now() - daysAgo * 24 * 3_600_000),
      userId,
    ]);
  }

  async function expectGone(userId: string) {
    expect(await ds.getRepository(User).countBy({ id: userId })).toBe(0);
  }
  async function expectKept(userId: string) {
    expect(await ds.getRepository(User).countBy({ id: userId })).toBe(1);
    survivors.push(userId);
  }

  afterEach(async () => {
    // Leave the throwaway DB as this suite found it.
    for (const id of survivors.splice(0)) {
      await ds.getRepository(User).delete(id);
    }
  });

  it('purges an account whose last_login is older than the window (pre-PD-D4 behavior kept)', async () => {
    const userId = await seedUser('stale-login');
    await backdate('last_login', userId, 30); // window is 14 days

    await expect(sweep()).resolves.toBe(1);
    await expectGone(userId);
  });

  it('purges a never-logged-in account (last_login NULL) once created_at passes the window — the PD-D4 fix', async () => {
    const userId = await seedUser('never-logged-in');
    // registration never sets last_login — it stays NULL here
    await backdate('created_at', userId, 30);

    // Before the fix this resolved to 0 and the row survived every sweep:
    // SQL `NULL < cutoff` is never true.
    await expect(sweep()).resolves.toBe(1);
    await expectGone(userId);
  });

  it('purges the never-logged-in account as a full tenant (its document is wiped too)', async () => {
    const userId = await seedUser('never-logged-in-docs');
    await backdate('created_at', userId, 30);
    await ds.getRepository(Document).save({
      user_id: userId,
      type: DocumentType.INVOICE,
      status: DocumentStatus.UPLOADED,
      original_filename: 'pdd4.pdf',
      s3_key: `uploads/it/pdd4-${Date.now()}.pdf`,
      mime_type: 'application/pdf',
      file_size: 1000,
    });

    await expect(sweep()).resolves.toBe(1);
    await expectGone(userId);
    // Retention rides deleteAccount — the tenant's rows go with the user.
    expect(await ds.getRepository(Document).countBy({ user_id: userId })).toBe(0);
  });

  it('keeps a fresh never-logged-in account — NULL last_login alone is not enough', async () => {
    const userId = await seedUser('fresh-never-logged-in'); // created_at = now

    await expect(sweep()).resolves.toBe(0);
    await expectKept(userId);
  });

  it('keeps an old account that logged in recently — a fresh last_login protects it', async () => {
    const userId = await seedUser('recent-login');
    await backdate('created_at', userId, 30); // account itself is old…
    await ds.getRepository(User).update(userId, { last_login: new Date() }); // …but logged in now

    await expect(sweep()).resolves.toBe(0);
    await expectKept(userId);
  });

  it('purges exactly the eligible accounts in one mixed sweep', async () => {
    const staleLogin = await seedUser('mix-stale-login');
    await backdate('last_login', staleLogin, 30);
    const neverLoggedInOld = await seedUser('mix-never-logged-in');
    await backdate('created_at', neverLoggedInOld, 30);
    const freshNeverLoggedIn = await seedUser('mix-fresh');
    const recentLogin = await seedUser('mix-recent-login');
    await backdate('created_at', recentLogin, 30);
    await ds.getRepository(User).update(recentLogin, { last_login: new Date() });

    await expect(sweep()).resolves.toBe(2);

    await expectGone(staleLogin);
    await expectGone(neverLoggedInOld);
    await expectKept(freshNeverLoggedIn);
    await expectKept(recentLogin);
  });
});
