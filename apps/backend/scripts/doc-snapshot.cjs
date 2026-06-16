// Snapshot one document's extraction state (for before/after Bug A test).
// usage: node doc-snapshot.cjs <documentId>
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
const docId = process.argv[2];

(async () => {
  const c = await pool.connect();
  try {
    const d = await c.query(`SELECT id, type, status, "invoiceId" FROM documents WHERE id = $1`, [docId]);
    console.log('— Document —'); console.table(d.rows[0] || { error: 'not found' });
    const invId = d.rows[0]?.invoiceId;
    const ext = await c.query(`
      SELECT field_name, count(*)::int AS n
      FROM field_extractions WHERE document_id = $1
      GROUP BY field_name ORDER BY field_name`, [docId]);
    console.log('— field_extractions per field —'); console.table(ext.rows);
    const items = await c.query(`SELECT count(*)::int AS items FROM invoice_items WHERE invoice_id = $1`, [invId]);
    console.log('— items on linked invoice —'); console.table({ invoiceId: invId, ...items.rows[0] });
  } finally { c.release(); await pool.end(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
