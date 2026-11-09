// PD-D4 unit tests — pin the retention sweep's candidate contract at the
// repository boundary. The defect: the where-clause only compared
// `last_login < cutoff`, and SQL `NULL < cutoff` is never true, so accounts
// that registered but never logged in were invisible to the sweep forever.
// These tests pin what the service now ASKS the database for (two OR'd
// branches; never-logged-in accounts age from created_at). The actual SQL
// NULL semantics are proven against real Postgres by
// demo-retention.service.integration.spec.ts.
import { FindOperator, Repository } from 'typeorm';
import { DemoRetentionService } from './demo-retention.service';
import { AccountService } from '../auth/account.service';
import { User } from '../auth/entities/user.entity';

interface WhereBranch {
  last_login?: FindOperator<Date>;
  created_at?: FindOperator<Date>;
}

describe('DemoRetentionService.sweep (unit, PD-D4)', () => {
  let service: DemoRetentionService;
  let find: jest.Mock;
  let deleteAccount: jest.Mock;
  let prevRetention: string | undefined;

  const makeService = () => {
    find = jest.fn();
    deleteAccount = jest.fn();
    service = new DemoRetentionService(
      { find } as unknown as Repository<User>,
      { deleteAccount } as unknown as AccountService,
    );
  };

  const lastFindArg = (): {
    where: WhereBranch[];
    select: string[];
    take: number;
  } =>
    find.mock.calls[0][0] as {
      where: WhereBranch[];
      select: string[];
      take: number;
    };

  beforeEach(() => {
    prevRetention = process.env.DEMO_RETENTION_DAYS;
    process.env.DEMO_RETENTION_DAYS = '14';
    makeService();
  });

  afterEach(() => {
    if (prevRetention === undefined) delete process.env.DEMO_RETENTION_DAYS;
    else process.env.DEMO_RETENTION_DAYS = prevRetention;
  });

  it('asks for two OR branches: stale last_login, and NULL last_login with old created_at', async () => {
    find.mockResolvedValue([]);

    await service.sweep();

    expect(find).toHaveBeenCalledTimes(1);
    const arg = lastFindArg();
    expect(arg.select).toEqual(['id']);
    expect(arg.take).toBe(50); // MAX_PURGE_PER_RUN unchanged

    expect(arg.where).toHaveLength(2);
    const [loggedIn, neverLoggedIn] = arg.where;

    // Branch 1: logged-in accounts age from last_login only.
    expect(Object.keys(loggedIn)).toEqual(['last_login']);
    expect(loggedIn.last_login).toBeInstanceOf(FindOperator);
    expect(loggedIn.last_login!.type).toBe('lessThan');

    // Branch 2: never-logged-in accounts — last_login IS NULL AND created_at
    // older than the window. The IsNull() here is the PD-D4 fix; without it
    // TypeORM would emit `last_login = NULL`, which is never true either.
    expect(Object.keys(neverLoggedIn).sort()).toEqual(['created_at', 'last_login']);
    expect(neverLoggedIn.last_login).toBeInstanceOf(FindOperator);
    expect(neverLoggedIn.last_login!.type).toBe('isNull');
    expect(neverLoggedIn.created_at).toBeInstanceOf(FindOperator);
    expect(neverLoggedIn.created_at!.type).toBe('lessThan');

    // Both cutoffs are "now minus the configured window" (14 days).
    const expected = Date.now() - 14 * 24 * 3_600_000;
    expect(Math.abs(loggedIn.last_login!.value.getTime() - expected)).toBeLessThan(5_000);
    expect(Math.abs(neverLoggedIn.created_at!.value.getTime() - expected)).toBeLessThan(5_000);
  });

  it('purges every returned candidate through AccountService.deleteAccount and returns the count', async () => {
    find.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    deleteAccount.mockResolvedValue({ queuedStorageKeys: 0 });

    await expect(service.sweep()).resolves.toBe(2);

    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(deleteAccount).toHaveBeenNthCalledWith(1, 'a');
    expect(deleteAccount).toHaveBeenNthCalledWith(2, 'b');
  });

  it('counts only successes and keeps purging after one tenant fails', async () => {
    find.mockResolvedValue([{ id: 'broken' }, { id: 'fine' }, { id: 'also-fine' }]);
    deleteAccount.mockImplementation(async (id: string) => {
      if (id === 'broken') throw new Error('23503 boom');
      return { queuedStorageKeys: 0 };
    });

    await expect(service.sweep()).resolves.toBe(2);

    // All three attempted — the failure never blocks the rest.
    expect(deleteAccount).toHaveBeenCalledTimes(3);
    expect(deleteAccount).toHaveBeenNthCalledWith(2, 'fine');
    expect(deleteAccount).toHaveBeenNthCalledWith(3, 'also-fine');
  });

  it('returns 0 and touches nothing when retention is disabled', async () => {
    delete process.env.DEMO_RETENTION_DAYS;

    await expect(service.sweep()).resolves.toBe(0);

    expect(find).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
  });

  it('returns 0 without any purge when the database reports no candidates', async () => {
    find.mockResolvedValue([]);

    await expect(service.sweep()).resolves.toBe(0);

    expect(deleteAccount).not.toHaveBeenCalled();
  });
});
