/**
 * One-off: enable Row-Level Security on every table in the `public` schema.
 *
 * Why: Supabase flagged `rls_disabled_in_public` — with RLS off, the public
 * Data API (PostgREST, anon key) can read/write every table.
 *
 * Why this is safe for the app: Doclos connects via a direct Postgres
 * connection (TypeORM/pg) as the `postgres` superuser role, which BYPASSES
 * RLS. It does NOT use the Supabase Data API. So enabling RLS with no
 * policies locks down the public API while leaving the app untouched.
 *
 * Usage: node apps/backend/scripts/enable-rls.cjs
 */
const pg = require('pg');
const dotenv = require('dotenv');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

// WSL2 doesn't route IPv6 to external hosts — force IPv4 (matches data-source.ts).
dns.setDefaultResultOrder('ipv4first');

// Load the project .env (../../../.env from apps/backend/scripts → repo root).
const envCandidates = [
  path.join(__dirname, '../../../.env'),
  path.join(process.cwd(), '.env'),
];
for (const p of envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p });
    break;
  }
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('✗ DATABASE_URL is not set');
  process.exit(1);
}

// Parse the URL ourselves — pg-connection-string chokes on this pooler URL
// (username postgres.<ref>), so mirror data-source.ts and pass fields directly.
const m = databaseUrl.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
if (!m) {
  console.error('✗ Could not parse DATABASE_URL:', databaseUrl.replace(/:[^@]+@/, ':***@'));
  process.exit(1);
}
const [, dbUser, dbPass, dbHost, dbPort, dbName] = m;
const useSsl = dbHost.includes('pooler.supabase.com');
console.log(`Connecting as ${dbUser} → ${dbHost}:${dbPort}/${dbName} (ssl: ${useSsl})\n`);

const pool = new pg.Pool({
  host: dbHost,
  port: parseInt(dbPort, 10),
  user: dbUser,
  password: dbPass,
  database: dbName,
  ssl: useSsl ? { rejectUnauthorized: false } : false, // dev TLS debt — see tls-security-todo
  connectionTimeoutMillis: 15000,
});

(async () => {
  let client;
  try {
    client = await pool.connect();
    console.log('✓ Connected to database\n');

    // 1) Confirm the app role bypasses RLS (precondition for safety).
    const roleInfo = await client.query(`
      SELECT current_user,
             session_user,
             (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) AS is_superuser,
             (SELECT rolbypassrls FROM pg_roles WHERE rolname = session_user) AS bypasses_rls;
    `);
    console.log('— Connection role check —');
    console.table(roleInfo.rows[0]);
    const bypasses = roleInfo.rows[0].bypasses_rls || roleInfo.rows[0].is_superuser;
    if (!bypasses) {
      console.error('✗ The connecting role does NOT bypass RLS. Aborting — enabling RLS could break the app.');
      process.exitCode = 1;
      return;
    }
    console.log('✓ Connecting role bypasses RLS — safe to proceed.\n');

    // 2) Show current RLS status before.
    const before = await client.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
    console.log('— RLS status BEFORE —');
    console.table(before.rows);

    // 3) Enable RLS on every base table in public.
    await client.query(`
      DO $$
      DECLARE t record;
      BEGIN
        FOR t IN
          SELECT c.relname AS relname
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r'
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
          RAISE NOTICE 'RLS enabled on public.%', t.relname;
        END LOOP;
      END $$;
    `);

    // 4) Verify after.
    const after = await client.query(`
      SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      ORDER BY c.relname;
    `);
    console.log('\n— RLS status AFTER —');
    console.table(after.rows);

    const allOn = after.rows.every((r) => r.rls_enabled);
    console.log(allOn ? '\n✅ RLS enabled on ALL public tables.' : '\n⚠️  Some tables still have RLS disabled — review the table above.');
  } catch (err) {
    console.error('✗ Error:', err.message);
    process.exitCode = 1;
  } finally {
    if (client) client.release();
    await pool.end();
  }
})();
