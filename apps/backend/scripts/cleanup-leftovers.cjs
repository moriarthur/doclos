/**
 * MAINTENANCE script — DESTRUCTIVE. Run manually by an operator with DB credentials.
 * Deletes orphan invoices + their items and dedupes field_extractions. Already
 * executed once (2026-06-14). Runs in a single transaction and reports (via
 * RETURNING) exactly what was removed before COMMIT.
 */
const pg = require('pg');
const dotenv = require('dotenv');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

dns.setDefaultResultOrder('ipv4first');
for (const p of [path.join(__dirname, '../../../.env'), path.join(process.cwd(), '.env')]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}
const url = process.env.DATABASE_URL;
const m = url.match(/postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
const pool = new pg.Pool({
  host: m[3], port: parseInt(m[4], 10), user: m[1], password: m[2], database: m[5],
  ssl: { rejectUnauthorized: false }, // dev TLS debt — see tls-security-todo
});

(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');

    const orphans = await c.query(`
      SELECT i.id FROM invoices i
      LEFT JOIN documents d ON d."invoiceId" = i.id
      WHERE d."invoiceId" IS NULL`);
    const orphanIds = orphans.rows.map((r) => r.id);

    let delItems = 0;
    let delInvoices = 0;
    if (orphanIds.length) {
      const di = await c.query(
        `DELETE FROM invoice_items WHERE invoice_id = ANY($1::uuid[]) RETURNING id`,
        [orphanIds]);
      delItems = di.rowCount;
      const dv = await c.query(
        `DELETE FROM invoices WHERE id = ANY($1::uuid[]) RETURNING id`,
        [orphanIds]);
      delInvoices = dv.rowCount;
    }

    const dd = await c.query(`
      DELETE FROM field_extractions
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (PARTITION BY document_id, field_name ORDER BY created_at DESC) AS rn
          FROM field_extractions
        ) t
        WHERE rn > 1
      )
      RETURNING id`);
    const delDupExtractions = dd.rowCount;

    await c.query('COMMIT');
    console.log('Cleanup complete (committed):');
    console.log(`  orphan invoice_items deleted: ${delItems}`);
    console.log(`  orphan invoices deleted:      ${delInvoices}`);
    console.log(`  duplicate extractions deleted: ${delDupExtractions}`);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('Rolled back. Error:', e.message);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
