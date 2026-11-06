import { MigrationInterface, QueryRunner } from 'typeorm';

// RLS-1 (Supabase Advisor): `rls_disabled_in_public` on public.refresh_sessions
// (created by PD-A2) and public.pending_storage_deletions (created by PD-T1).
// The one-off scripts/enable-rls.cjs already enabled RLS on the deployed
// database, but the script is not part of the migration chain — tables added
// afterwards (and every fresh CI/dev/restored database replaying migrations)
// come back with RLS disabled. On Supabase, public tables with RLS off are
// reachable through the Data API (PostgREST, anon key) subject to grants
// alone; with RLS enabled and zero policies they return zero rows.
//
// Scope: ONLY these two tables (one finding, one commit). No policies are
// created and no grants are touched: Doclos never uses the Supabase Data API
// — it connects over a direct Postgres connection (TypeORM/pg,
// data-source.ts). A role that bypasses RLS (superuser / BYPASSRLS / the
// table owner, since we deliberately do NOT set FORCE ROW LEVEL SECURITY)
// keeps full access; every other role gets default-deny, which is the
// lockdown Advisor asks for.
interface RolePreflightRow {
  is_superuser: boolean;
  bypasses_rls: boolean;
  owned: string; // pg COUNT comes back as a string through node-pg
  existing: string;
}

export class EnableRlsOnInternalTables1793923200000 implements MigrationInterface {
  name = 'EnableRlsOnInternalTables1793923200000';

  private static readonly TABLES = [
    'refresh_sessions',
    'pending_storage_deletions',
  ] as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same preflight as scripts/enable-rls.cjs: refuse to run when the
    // connecting role neither bypasses RLS nor owns every target table that
    // exists. With zero policies a subject role would read zero rows — the
    // app itself would break on the next query against these tables.
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
        AND c.relname IN ('refresh_sessions', 'pending_storage_deletions')
    `)) as RolePreflightRow[];
    const preflight = rows[0];
    const bypasses = preflight.is_superuser || preflight.bypasses_rls;
    const ownsAll = preflight.existing === preflight.owned; // both '0' → nothing to alter
    if (!bypasses && !ownsAll) {
      throw new Error(
        'EnableRlsOnInternalTables: the connecting role neither bypasses RLS nor owns ' +
          'refresh_sessions/pending_storage_deletions. Enabling RLS with no policies would ' +
          'hide every row of these tables from this role (the backend reads both). ' +
          'Run migrations as a role with BYPASSRLS or superuser (e.g. the Supabase ' +
          '"postgres" role) — same precondition scripts/enable-rls.cjs checks.',
      );
    }

    // ENABLE ROW LEVEL SECURITY is idempotent (re-enabling is a no-op) and
    // IF EXISTS keeps this safe on partially-provisioned databases. FORCE is
    // deliberately not set: the owner must keep working without policies.
    for (const table of EnableRlsOnInternalTables1793923200000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS public."${table}" ENABLE ROW LEVEL SECURITY`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverts exactly what up() changed: RLS off on these two tables only —
    // no other table, no policies (none were created), no grants.
    for (const table of EnableRlsOnInternalTables1793923200000.TABLES) {
      await queryRunner.query(
        `ALTER TABLE IF EXISTS public."${table}" DISABLE ROW LEVEL SECURITY`,
      );
    }
  }
}
