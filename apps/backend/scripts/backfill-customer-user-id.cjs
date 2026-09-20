// P0-2 (audit): one-off backfill — attribute existing customers rows to their
// owning user via documents.customer_id → documents.user_id.
// Rows referenced by no document or by documents of SEVERAL users (the old
// cross-tenant mixing bug) cannot be attributed: they are logged and left
// with user_id IS NULL so no tenant ever sees them.
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
    const { rows: customers } = await client.query(`SELECT id, name, user_id FROM customers;`);
    const { rows: pairs } = await client.query(
      `SELECT DISTINCT customer_id, user_id FROM documents WHERE customer_id IS NOT NULL;`,
    );

    const ownersByCustomer = new Map();
    for (const { customer_id, user_id } of pairs) {
      if (!ownersByCustomer.has(customer_id)) ownersByCustomer.set(customer_id, new Set());
      ownersByCustomer.get(customer_id).add(user_id);
    }

    let attributed = 0, ambiguous = 0, orphaned = 0, alreadySet = 0;
    for (const c of customers) {
      if (c.user_id) { alreadySet++; continue; }
      const owners = ownersByCustomer.get(c.id);
      if (!owners || owners.size === 0) {
        orphaned++;
        console.log(`[unattributed] ${c.id} "${c.name}" — no document references it, left NULL`);
        continue;
      }
      if (owners.size > 1) {
        ambiguous++;
        console.log(`[ambiguous] ${c.id} "${c.name}" — referenced by ${owners.size} users (pre-fix mixing), left NULL`);
        continue;
      }
      const owner = [...owners][0];
      await client.query(`UPDATE customers SET user_id = $1 WHERE id = $2;`, [owner, c.id]);
      attributed++;
      console.log(`[ok] ${c.id} "${c.name}" → user ${owner}`);
    }

    console.log(`\nDone: ${attributed} attributed, ${alreadySet} already set, ${ambiguous} ambiguous (NULL), ${orphaned} orphaned (NULL), of ${customers.length} rows.`);
  } finally {
    client.release();
    await pool.end();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
