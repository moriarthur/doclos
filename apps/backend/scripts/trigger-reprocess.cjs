// Enqueue a reprocess-document job directly on the Bull 'documents' queue (bypasses HTTP auth).
// usage: node trigger-reprocess.cjs <documentId> [userId]
const bull = require('bull');
const dotenv = require('dotenv');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

dns.setDefaultResultOrder('ipv4first');
for (const p of [path.join(__dirname, '../../../.env'), path.join(process.cwd(), '.env')]) {
  if (fs.existsSync(p)) { dotenv.config({ path: p }); break; }
}

const documentId = process.argv[2];
const userId = process.argv[3] || 'a9ff617e-8345-4a3f-8364-93cca13b863b';
if (!documentId) {
  console.error('usage: node trigger-reprocess.cjs <documentId> [userId]');
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
