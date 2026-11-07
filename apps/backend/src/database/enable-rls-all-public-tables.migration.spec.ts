// RLS-2 — unit checks for the EnableRlsOnAllPublicTables migration's SQL
// contract, no database needed. Pins down the four properties the fix stands
// on: up() covers EVERY public base table via a table-agnostic catalog loop
// (no static list to go stale), ENABLEs (never FORCEs) RLS behind the same
// role preflight as the script and 1793923200000, creates no policies and
// grants nothing, and down() refuses to run at all — a rollback must never
// disable an already-enabled lockdown. The database-level proof (clean
// replay, script-protected replay, rollback refusal, grants untouched) lives
// in the CI migrations job.
import { QueryRunner } from 'typeorm';
import { EnableRlsOnAllPublicTables1794806400000 } from './migrations/1794806400000-EnableRlsOnAllPublicTables';

interface PreflightRow {
  is_superuser: boolean;
  bypasses_rls: boolean;
  owned: string;
  existing: string;
}

function makeRunner(preflight: PreflightRow): {
  runner: QueryRunner;
  queries: string[];
} {
  const queries: string[] = [];
  const runner = {
    query: jest.fn(async (sql: string) => {
      queries.push(sql);
      if (sql.includes('pg_roles')) return [preflight];
      return undefined;
    }),
  } as unknown as QueryRunner;
  return { runner, queries };
}

const lockdownQueries = (queries: string[]) =>
  queries.filter((q) => q.includes('ENABLE ROW LEVEL SECURITY'));

describe('EnableRlsOnAllPublicTables1794806400000 (RLS-2)', () => {
  let migration: EnableRlsOnAllPublicTables1794806400000;

  beforeEach(() => {
    migration = new EnableRlsOnAllPublicTables1794806400000();
  });

  describe('up()', () => {
    it('issues a single table-agnostic lockdown loop over the public schema', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '0',
        existing: '11',
      });
      await migration.up(runner);
      const statements = lockdownQueries(queries);
      expect(statements).toHaveLength(1);
      expect(statements[0]).toContain('DO $$');
      // No static table list: the loop reads the catalog, so it covers every
      // current AND future public base table.
      expect(statements[0]).toContain("n.nspname = 'public'");
      expect(statements[0]).toContain("c.relkind = 'r'");
      expect(statements[0]).toContain('ENABLE ROW LEVEL SECURITY');
    });

    it('never FORCEs RLS — the table owner must keep bypassing it', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: false,
        bypasses_rls: true,
        owned: '0',
        existing: '11',
      });
      await migration.up(runner);
      expect(
        queries.every((q) => !/FORCE ROW LEVEL SECURITY/.test(q)),
      ).toBe(true);
    });

    it('creates no policies, grants nothing, and never disables RLS', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '0',
        existing: '11',
      });
      await migration.up(runner);
      expect(
        queries.every(
          (q) => !/CREATE POLICY|GRANT |REVOKE |DISABLE ROW LEVEL SECURITY/.test(q),
        ),
      ).toBe(true);
    });

    it.each([
      [
        'superuser role runs',
        { is_superuser: true, bypasses_rls: false, owned: '0', existing: '11' },
      ],
      [
        'BYPASSRLS role runs',
        { is_superuser: false, bypasses_rls: true, owned: '0', existing: '11' },
      ],
      [
        'role owning every public table runs',
        { is_superuser: false, bypasses_rls: false, owned: '11', existing: '11' },
      ],
      [
        'role owning nothing still runs when no table exists',
        { is_superuser: false, bypasses_rls: false, owned: '0', existing: '0' },
      ],
    ])('preflight allows: %s', async (_label, preflight) => {
      const { runner } = makeRunner(preflight);
      await expect(migration.up(runner)).resolves.toBeUndefined();
    });

    it.each([
      [
        'partial ownership (9 of 11)',
        { is_superuser: false, bypasses_rls: false, owned: '9', existing: '11' },
      ],
      [
        'plain role without bypass on existing tables',
        { is_superuser: false, bypasses_rls: false, owned: '0', existing: '11' },
      ],
    ])('preflight refuses: %s', async (_label, preflight) => {
      const { runner, queries } = makeRunner(preflight);
      await expect(migration.up(runner)).rejects.toThrow(/BYPASSRLS/);
      // The refusal happens before any DDL — no ALTER ever goes out.
      expect(lockdownQueries(queries)).toHaveLength(0);
    });
  });

  describe('down()', () => {
    it('refuses to run and issues no SQL — rollback must not weaken the lockdown', async () => {
      const { queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '11',
        existing: '11',
      });
      await expect(migration.down()).rejects.toThrow(/irreversible/);
      // Nothing went out: no DISABLE, no ALTER of any kind.
      expect(queries).toHaveLength(0);
    });
  });
});
