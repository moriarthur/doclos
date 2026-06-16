// Verification helper: inspect document types and invoice items directly in the DB.
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
  connectionTimeoutMillis: 15000,
});

(async () => {
  const client = await pool.connect();
  try {
    console.log('— Documents by type/status —');
    const types = await client.query(`
      SELECT type, status, count(*)::int AS n
      FROM documents GROUP BY type, status ORDER BY type, status;`);
    console.table(types.rows);

    console.log('— Sample: viewed document 930595c4 (type + invoiceId) —');
    const doc = await client.query(`
      SELECT id, type, status, "invoiceId" FROM documents WHERE id = '930595c4-7919-4e6e-ad90-e08261ae2687';`);
    console.table(doc.rows);

    console.log('— Invoice items for that invoice (51f9eb49...) —');
    const items = await client.query(`
      SELECT description, quantity, unit_price, line_total
      FROM invoice_items WHERE invoice_id = '51f9eb49-70d0-4b68-acb1-4b3aaf64aaf8'
      ORDER BY created_at;`);
    console.table(items.rows);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
