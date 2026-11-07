import { MigrationInterface, QueryRunner } from 'typeorm';

// RLS-2 (clean-database replay audit): the migration chain itself only ever
// enabled RLS on refresh_sessions and pending_storage_deletions
// (1793923200000). The deployed database owes its full lockdown to the
// one-off scripts/enable-rls.cjs, which is not part of the chain — so every
// fresh database (new Supabase project, CI, restore) replayed the other 9
// public tables with RLS disabled and reachable through the Supabase Data
// API (PostgREST, anon key) subject to grants alone. This migration closes
// the gap: it ENABLEs row-level security on EVERY base table in `public`,
// mirroring the script, so a clean replay ends in the same state production
// already has.
//
// Guarantees, kept deliberately narrow:
//  - Idempotent: `ENABLE ROW LEVEL SECURITY` is a no-op on tables that
//    already have it — on the deployed database (protected by the script)
//    up() changes nothing.
//  - Same preflight as 1793923200000 and the script: refuse to run when the
//    connecting role neither bypasses RLS nor owns every public table.
//    With zero policies a subject role would read zero rows — the app
//    itself would break on the next query.
//  - No policies, no grants: a bare ENABLE is exactly the lockdown the
//    Supabase Advisor asks for, and the app never uses the Data API
//    (data-source.ts connects over plain Postgres as the owning/bypassing
//    role).
//  - FORCE is deliberately not set: the owner must keep working without
//    policies (same reasoning as 1793923200000).
//
// Intentionally irreversible: down() throws. Reverting this migration would
// DISABLE row-level security on public tables — on the deployed database
// that would re-open the Data API through existing grants. RLS-1's down()
// could safely disable because its two tables had nothing enabled before;
// here the migration's whole point is that the pre-existing state must not
// be weakened by a rollback. To tear down a disposable database, disable
// RLS explicitly with psql — never through migration:revert.
interface RolePreflightRow {
  is_superuser: boolean;
  bypasses_rls: boolean;
  owned: string; // pg COUNT comes back as a string through node-pg
  existing: string;
}

export class EnableRlsOnAllPublicTables1794806400000 implements MigrationInterface {
  name = 'EnableRlsOnAllPublicTables1794806400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same preflight as scripts/enable-rls.cjs and 1793923200000, generalized
    // to every base table in public (relkind 'r' — the schema has no
    // partitioned tables, and TypeORM's `migrations` bookkeeping table is
    // included on purpose, matching the script's scope).
    const rows = (await queryRunner.query(`
      SELECT
        (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS is_superuser,
        (SELECT rolbypassrls FROM pg_roles WHERE rolname = session_user) AS bypasses_rls,
        count(*) FILTER (WHERE c.relowner = r.oid) AS owned,
        count(*) AS existing
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN (SELECT oid FROM pg_roles WHERE rolname = session_user) r
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
    `)) as RolePreflightRow[];
    const preflight = rows[0];
    const bypasses = preflight.is_superuser || preflight.bypasses_rls;
    const ownsAll = preflight.existing === preflight.owned; // both '0' → nothing to alter
    if (!bypasses && !ownsAll) {
      throw new Error(
        'EnableRlsOnAllPublicTables: the connecting role neither bypasses RLS nor owns ' +
          'every table in the public schema. Enabling RLS with no policies would hide ' +
          'every row of those tables from this role (the backend reads all of them). ' +
          'Run migrations as a role with BYPASSRLS or superuser (e.g. the Supabase ' +
          '"postgres" role) — same precondition scripts/enable-rls.cjs checks.',
      );
    }

    // ENABLE ROW LEVEL SECURITY is idempotent (re-enabling is a no-op), so on
    // a database already locked down by the one-off script this changes
    // nothing; on a fresh replay it locks down everything, including tables
    // created by earlier migrations that 1793923200000 did not cover.
    await queryRunner.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT c.relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
        END LOOP;
      END $$;
    `);
  }

  public async down(): Promise<void> {
    // See the header: reverting would re-open the Data API on databases that
    // are already protected (production). Throw BEFORE any DDL — the revert
    // transaction aborts and the migration stays applied, RLS stays enabled.
    throw new Error(
      'EnableRlsOnAllPublicTables is intentionally irreversible: reverting would ' +
        'DISABLE row-level security on public tables and re-open the Supabase Data ' +
        'API on already-protected databases (production). If you really need to tear ' +
        'down a disposable database, disable RLS explicitly with psql — never via ' +
        'migration:revert.',
    );
  }
}
