// Demo reset / cleanup — wipes everything the demo account owns so a demo
// session can start from a clean slate:
//
//   DEMO_EMAIL=... pnpm demo:reset
//
// Deletes (scoped to the demo user, other accounts are never touched):
//   field_extractions → jobs → invoice_items → invoices → documents →
//   customers → audit_logs, plus best-effort deletion of the uploaded
//   storage objects in S3/R2.
//
// The demo account itself is kept — re-run `pnpm db:seed` afterwards if you
// also want to (re-)write the sample invoice file.

import { In, DataSource } from 'typeorm';
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';
import Bull from 'bull';
import { User } from '../../modules/auth/entities/user.entity';
import { Document } from '../../modules/documents/entities/document.entity';
import { Invoice } from '../../modules/documents/entities/invoice.entity';
import { InvoiceItem } from '../../modules/documents/entities/invoice-item.entity';
import { FieldExtraction } from '../../modules/documents/entities/field-extraction.entity';
import { Job } from '../../modules/jobs/entities/job.entity';
import { AuditLog } from '../../modules/jobs/entities/audit-log.entity';
import { Customer } from '../../modules/documents/entities/customer.entity';
import { dataSourceOptions } from '../data-source';

/** Best-effort storage cleanup — DB rows are already gone at this point. */
async function deleteStorageObjects(keys: string[]): Promise<void> {
  const { S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION } =
    process.env;
  if (!S3_ENDPOINT || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.warn('⚠️  S3_* env vars not fully set — skipping storage object cleanup');
    return;
  }
  const client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION || 'auto',
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  });
  try {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000).map((Key) => ({ Key }));
      await client.send(
        new DeleteObjectsCommand({ Bucket: S3_BUCKET, Delete: { Objects: chunk } }),
      );
    }
    console.log(`✅ deleted ${keys.length} storage object(s)`);
  } catch (err) {
    console.warn(
      '⚠️  storage object cleanup failed (database rows were deleted):',
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Remove Bull jobs that belong to the demo user from the `documents` queue
 * (any state) — otherwise a reset during active processing leaves zombie
 * jobs whose document rows are already gone. Best-effort: a Redis outage
 * must not hide that the database reset itself succeeded.
 */
async function purgeQueueJobs(userId: string): Promise<number> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    console.warn('⚠️  REDIS_URL not set — skipping Bull queue cleanup');
    return 0;
  }
  // One-shot script: only non-blocking commands (getJobs/remove) are used,
  // so no worker-specific ioredis tuning is required.
  const queue = new Bull('documents', redisUrl);
  try {
    const jobs = await queue.getJobs(
      ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'],
      0,
      1000,
      true,
    );
    if (jobs.length > 1000) {
      console.warn(
        '⚠️  queue listing hit the 1000-job page cap — run the reset again to purge the rest',
      );
    }
    const mine = jobs.filter((job) => (job.data as { userId?: string })?.userId === userId);
    let removed = 0;
    for (const job of mine) {
      try {
        await job.remove();
        removed += 1;
      } catch {
        // Job already completed/removed between listing and removal.
      }
    }
    return removed;
  } catch (err) {
    console.warn(
      '⚠️  Bull queue cleanup failed (database rows were deleted):',
      err instanceof Error ? err.message : err,
    );
    return 0;
  } finally {
    await queue.close().catch(() => undefined);
  }
}

async function main() {
  const email = (process.env.DEMO_EMAIL || '').toLowerCase().trim();
  if (!email) {
    throw new Error('DEMO_EMAIL must be set (see .env.example) before running the demo reset');
  }

  const dataSource = new DataSource(dataSourceOptions);
  await dataSource.initialize();
  try {
    const user = await dataSource.getRepository(User).findOne({ where: { email } });
    if (!user) {
      console.log(`ℹ️  no account for ${email} — nothing to reset`);
      return;
    }

    const documents = await dataSource.getRepository(Document).find({
      where: { user_id: user.id },
      select: ['id', 'invoiceId', 's3_key'],
    });
    const documentIds = documents.map((d) => d.id);
    const invoiceIds = documents
      .map((d) => d.invoiceId)
      .filter((v): v is string => Boolean(v));
    const s3Keys = documents.map((d) => d.s3_key).filter((v): v is string => Boolean(v));

    await dataSource.transaction(async (manager) => {
      // Children first (FKs point at documents/invoices).
      if (documentIds.length) {
        await manager.delete(FieldExtraction, { document_id: In(documentIds) });
        await manager.delete(Job, { document_id: In(documentIds) });
      }
      if (invoiceIds.length) {
        // Drop documents.invoiceId first — same ordering constraint as the
        // per-document delete path in documents.service.deleteDocument.
        await manager
          .createQueryBuilder()
          .update(Document)
          .set({ invoiceId: () => 'NULL' })
          .where('user_id = :id', { id: user.id })
          .execute();
        await manager.delete(InvoiceItem, { invoice_id: In(invoiceIds) });
        await manager.delete(Invoice, { id: In(invoiceIds) });
      }
      await manager.delete(Document, { user_id: user.id });
      await manager.delete(Customer, { user_id: user.id });
      await manager.delete(AuditLog, { user_id: user.id });
    });

    console.log(`✅ reset complete for ${email}`);
    console.log(`   documents removed: ${documents.length}`);
    console.log(`   invoices removed:  ${invoiceIds.length}`);
    console.log('   (account kept — run `pnpm db:seed` to re-sync it / rewrite the sample)');

    const queuedRemoved = await purgeQueueJobs(user.id);
    if (queuedRemoved > 0) console.log(`   queue jobs removed: ${queuedRemoved}`);

    if (s3Keys.length) await deleteStorageObjects(s3Keys);
  } finally {
    await dataSource.destroy();
  }
}

const isDirectRun = process.argv[1]?.endsWith('demo.reset.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error('❌ demo reset failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
