// RLS-1 — unit checks for the EnableRlsOnInternalTables migration's SQL
// contract, no database needed. Pins down the three properties the fix stands
// on: up() touches ONLY the two Advisor-flagged tables, ENABLEs (never
// FORCEs) RLS behind the same role preflight as scripts/enable-rls.cjs, and
// down() reverts exactly those two tables. The database-level proof (clean
// DB, re-run, revert, restricted-role refusal) lives in the CI migrations job
// and the runbook; this spec keeps the contract from drifting.
import { QueryRunner } from 'typeorm';
import { EnableRlsOnInternalTables1793923200000 } from './migrations/1793923200000-EnableRlsOnInternalTables';

const TABLES = ['refresh_sessions', 'pending_storage_deletions'] as const;

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

const alters = (queries: string[]) =>
  queries.filter((q) => q.includes('ROW LEVEL SECURITY'));

describe('EnableRlsOnInternalTables1793923200000 (RLS-1)', () => {
  let migration: EnableRlsOnInternalTables1793923200000;

  beforeEach(() => {
    migration = new EnableRlsOnInternalTables1793923200000();
  });

  describe('up()', () => {
    it('ENABLEs RLS on exactly the two flagged tables, and nothing else', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '0',
        existing: '2',
      });
      await migration.up(runner);
      const statements = alters(queries);
      expect(statements).toHaveLength(2);
      for (const table of TABLES) {
        expect(statements).toContainEqual(
          expect.stringContaining(`public."${table}" ENABLE ROW LEVEL SECURITY`),
        );
      }
      expect(statements.every((q) => !/DISABLE ROW LEVEL SECURITY/.test(q))).toBe(
        true,
      );
    });

    it('never FORCEs RLS — the table owner must keep bypassing it', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: false,
        bypasses_rls: true,
        owned: '0',
        existing: '2',
      });
      await migration.up(runner);
      expect(alters(queries).every((q) => !/FORCE ROW LEVEL SECURITY/.test(q))).toBe(
        true,
      );
    });

    it('creates no policies and grants nothing', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '0',
        existing: '2',
      });
      await migration.up(runner);
      expect(queries.every((q) => !/CREATE POLICY|GRANT |REVOKE /.test(q))).toBe(
        true,
      );
    });

    it.each([
      [
        'superuser role runs',
        { is_superuser: true, bypasses_rls: false, owned: '0', existing: '2' },
      ],
      [
        'BYPASSRLS role runs',
        { is_superuser: false, bypasses_rls: true, owned: '0', existing: '2' },
      ],
      [
        'role owning both tables runs',
        { is_superuser: false, bypasses_rls: false, owned: '2', existing: '2' },
      ],
      [
        'role owning nothing still runs when no target table exists',
        { is_superuser: false, bypasses_rls: false, owned: '0', existing: '0' },
      ],
    ])('preflight allows: %s', async (_label, preflight) => {
      const { runner } = makeRunner(preflight);
      await expect(migration.up(runner)).resolves.toBeUndefined();
    });

    it.each([
      [
        'partial ownership (1 of 2)',
        { is_superuser: false, bypasses_rls: false, owned: '1', existing: '2' },
      ],
      [
        'plain role without bypass on existing tables',
        { is_superuser: false, bypasses_rls: false, owned: '0', existing: '2' },
      ],
    ])('preflight refuses: %s', async (_label, preflight) => {
      const { runner, queries } = makeRunner(preflight);
      await expect(migration.up(runner)).rejects.toThrow(/BYPASSRLS/);
      // The refusal happens before any DDL — no ALTER ever goes out.
      expect(alters(queries)).toHaveLength(0);
    });
  });

  describe('down()', () => {
    it('DISABLEs RLS on exactly the two tables, and nothing else', async () => {
      const { runner, queries } = makeRunner({
        is_superuser: true,
        bypasses_rls: false,
        owned: '0',
        existing: '2',
      });
      await migration.down(runner);
      const statements = alters(queries);
      expect(statements).toHaveLength(2);
      for (const table of TABLES) {
        expect(statements).toContainEqual(
          expect.stringContaining(`public."${table}" DISABLE ROW LEVEL SECURITY`),
        );
      }
      expect(statements.every((q) => !/ENABLE ROW LEVEL SECURITY/.test(q))).toBe(
        true,
      );
    });
  });
});
