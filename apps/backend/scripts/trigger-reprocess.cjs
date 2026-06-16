/**
 * DEV/TEST ONLY — enqueues a reprocess-document job directly on the Bull
 * 'documents' queue, BYPASSING the authenticated HTTP endpoint. Requires direct
 * Redis access (REDIS_URL). Do NOT use in production — prefer
 * POST /documents/:id/reprocess (which enforces ownership).
 *
 * usage: node trigger-reprocess.cjs <documentId> <userId>
 *   both args are REQUIRED and must be valid UUIDs; userId must own the document
 *   (the worker now verifies ownership).
 */
const bull = require('bull');
const dotenv = require('dotenv');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

dns.setDefaultResultOrder('ipv4first');
for (const p of [path.join(__dirname, '../../../.env'), path.join(process.cwd(), '.env')]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const documentId = process.argv[2];
const userId = process.argv[3];
if (!documentId || !userId || !UUID_RE.test(documentId) || !UUID_RE.test(userId)) {
  console.error('usage: node trigger-reprocess.cjs <documentId> <userId>  (both required, UUID v4)');
  process.exit(1);
}

const redisUrl = process.env.REDIS_URL || '';
const password = redisUrl.match(/rediss?:\/\/[^:]+:([^@]+)@/)?.[1];
const host = process.env.REDIS_HOST;
const port = parseInt(process.env.REDIS_PORT || '6379', 10);

const queue = new bull('documents', {
  redis: { host, port, password, tls: redisUrl.startsWith('rediss://') ? {} : undefined },
});

(async () => {
  const job = await queue.add('reprocess-document', { documentId, userId });
  console.log(`Enqueued reprocess-document job ${job.id} for document ${documentId}`);
  await queue.close();
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
