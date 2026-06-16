// Diagnostic: quantify Bug A — duplicate invoices / orphan items / accumulating extractions.
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
    console.log('— Totals —');
    const totals = await c.query(`
      SELECT
        (SELECT count(*)::int FROM documents) AS documents,
        (SELECT count(*)::int FROM documents WHERE "invoiceId" IS NOT NULL) AS docs_with_invoice,
        (SELECT count(*)::int FROM invoices) AS invoices,
        (SELECT count(*)::int FROM invoice_items) AS invoice_items,
        (SELECT count(*)::int FROM field_extractions) AS extractions;`);
    console.table(totals.rows[0]);

    console.log('— Orphan invoices (not linked by ANY document.invoiceId) —');
    const orphans = await c.query(`
      SELECT i.id, i.invoice_number, i.created_at
      FROM invoices i
      LEFT JOIN documents d ON d."invoiceId" = i.id
      WHERE d."invoiceId" IS NULL
      ORDER BY i.created_at DESC LIMIT 20;`);
    console.table(orphans.rows);
    console.log(`orphan invoice count: ${orphans.rows.length}${orphans.rows.length === 20 ? '+' : ''}`);

    console.log('— Duplicate field_extractions (same doc+field appearing >1) —');
    const dups = await c.query(`
      SELECT document_id, field_name, count(*)::int AS n
      FROM field_extractions
      GROUP BY document_id, field_name
      HAVING count(*) > 1
      ORDER BY n DESC LIMIT 20;`);
    console.table(dups.rows);
    console.log(`dup groups: ${dups.rows.length}`);

    console.log('— Orphan invoice_items (invoice_id not in invoices) —');
    const orphanItems = await c.query(`SELECT count(*)::int AS n FROM invoice_items it LEFT JOIN invoices i ON i.id = it.invoice_id WHERE i.id IS NULL;`);
    console.table(orphanItems.rows[0]);
  } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
