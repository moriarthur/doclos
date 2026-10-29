// DD-3 regression tests — deleteAccount (self-service AND the demo retention
// sweep, which rides the exact same path) against a REAL Postgres with the
// real migrated schema. The production defect: the invoices were deleted while
// documents."invoiceId" still referenced them →
// `update or delete on table "invoices" violates foreign key constraint
// "FK_998c6b9d2d3f298243299a14d72" on table "documents"` — the transaction
// rolled back and every retention sweep retried the same failure. The circular
// FKs are invisible to repository-mocked unit tests, which is exactly how it
// reached the deployed demo.
//
// Runs only when TEST_DATABASE_URL points at a throwaway database (migrations
// are applied automatically, the baseline is idempotent). Without the variable
// the whole suite self-skips, so plain `pnpm test` stays green everywhere.
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../../database/data-source';
import { User } from './entities/user.entity';
import { Customer } from '../documents/entities/customer.entity';
import { Document, DocumentStatus, DocumentType } from '../documents/entities/document.entity';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { FieldExtraction } from '../documents/entities/field-extraction.entity';
import { Job, JobStatus, JobType } from '../jobs/entities/job.entity';
import { PendingStorageDeletion } from '../storage/entities/pending-storage-deletion.entity';
import { StorageCleanupService } from '../storage/services/storage-cleanup.service';
import { S3Service } from '../storage/services/s3.service';
import { AccountService } from './account.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DATABASE_URL ? describe : describe.skip;

d('AccountService.deleteAccount (integration, DD-3)', () => {
  let ds: DataSource;
  // Holds the advisory lock for the whole suite — see beforeAll.
  let lockRunner: QueryRunner;
  let service: AccountService;
  let s3DeleteFile: jest.Mock;

  const makeService = () => {
    s3DeleteFile = jest.fn(async () => undefined);
    // Real StorageCleanupService over the real pending_storage_deletions table —
    // the retry-queue row IS the contract under test; only R2 itself is mocked.
    const storageCleanup = new StorageCleanupService(
      ds.getRepository(PendingStorageDeletion),
      { deleteFile: s3DeleteFile } as unknown as S3Service,
    );
    service = new AccountService(
      ds.getRepository(User),
      ds.getRepository(Document),
      ds,
      storageCleanup,
    );
  };

  beforeAll(async () => {
    const url = new URL(TEST_DATABASE_URL!);
    const options = {
      ...dataSourceOptions,
      host: url.hostname,
      port: Number(url.port) || 5432,
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ssl: false,
    } as DataSourceOptions;
    ds = new DataSource(options);
    await ds.initialize();
    // Serialize the DB integration suites: jest runs spec files in parallel
    // workers against this one database, and both suites drive the shared
    // pending_storage_deletions retry table (purgeQueued scans it globally, so
    // one suite's purge can delete another suite's rows mid-assertion). The
    // session-level advisory lock makes the runs mutually exclusive; a crashed
    // worker releases it implicitly by disconnecting. The lock rides a dedicated
    // query runner so acquire and unlock use the SAME pooled connection.
    lockRunner = ds.createQueryRunner();
    await lockRunner.query(`SELECT pg_advisory_lock(hashtext('doclos-backend-integration'))`);
    await ds.runMigrations(); // idempotent — the baseline skips applied steps
    // Deterministic retry-queue tests: older runs leave rows behind, and
    // purgeQueued() works from the oldest row.
    await ds.getRepository(PendingStorageDeletion).clear();
  });

  afterAll(async () => {
    await lockRunner?.query(`SELECT pg_advisory_unlock(hashtext('doclos-backend-integration'))`);
    await lockRunner?.release();
    await ds?.destroy();
  });

  async function seedUser(tag: string): Promise<string> {
    return (
      await ds.getRepository(User).save({
        email: `dd3-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password_hash: 'x',
        name: 'DD3 IT',
      })
    ).id;
  }

  /** Seed one document of a tenant, optionally with the full extracted graph. */
  async function seedDoc(
    userId: string,
    tag: string,
    opts: {
      status: DocumentStatus;
      invoice?: 'linked' | 'orphan';
      withJob?: boolean;
    },
  ): Promise<{ documentId: string; invoiceId?: string; s3Key: string }> {
    const customerId = (
      await ds.getRepository(Customer).save({ user_id: userId, name: `Supplier ${tag}` })
    ).id;
    const s3Key = `uploads/it/dd3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${tag}.pdf`;
    const documentId = (
      await ds.getRepository(Document).save({
        user_id: userId,
        customer_id: customerId,
        type: DocumentType.INVOICE,
        status: opts.status,
        original_filename: `${tag}.pdf`,
        s3_key: s3Key,
        mime_type: 'application/pdf',
        file_size: 1000,
        extraction_confidence: opts.invoice ? 0.9 : null,
      })
    ).id;

    let invoiceId: string | undefined;
    if (opts.invoice) {
      invoiceId = (
        await ds.getRepository(Invoice).save({
          document_id: documentId,
          invoice_number: `RE-${tag}`,
          amount_total: 119,
          vat_amount: 19,
          currency: 'EUR',
          supplier_name: `Supplier ${tag}`,
        })
      ).id;
      if (opts.invoice === 'linked') {
        // Linked: the documents."invoiceId" back-pointer is set (the normal
        // processed shape). Orphan leaves it NULL — the DD-1 crash leftover.
        await ds.getRepository(Document).update(documentId, { invoiceId });
        await ds.getRepository(FieldExtraction).save({
          document_id: documentId,
          field_name: 'invoice_number',
          value: `RE-${tag}`,
          confidence: 0.9,
          source: 'llm',
          snippet: '',
        });
      }
      await ds.getRepository(InvoiceItem).save({
        invoice_id: invoiceId,
        description: 'Position 1',
        quantity: 1,
        unit_price: 100,
        line_total: 100,
      });
    }
    if (opts.withJob) {
      await ds.getRepository(Job).save({
        job_type: JobType.PROCESS_DOCUMENT,
        status: JobStatus.COMPLETED,
        document_id: documentId,
        attempts: 1,
      });
    }
    return { documentId, invoiceId, s3Key };
  }

  const expectTenantGone = async (userId: string, invoiceIds: string[] = []) => {
    expect(await ds.getRepository(User).countBy({ id: userId })).toBe(0);
    expect(await ds.getRepository(Document).countBy({ user_id: userId })).toBe(0);
    expect(await ds.getRepository(Customer).countBy({ user_id: userId })).toBe(0);
    for (const invoiceId of invoiceIds) {
      expect(await ds.getRepository(Invoice).countBy({ id: invoiceId })).toBe(0);
      expect(await ds.getRepository(InvoiceItem).countBy({ invoice_id: invoiceId })).toBe(0);
    }
  };

  it('deletes an account with a fully processed document (linked invoice, items, extraction, job) — the retention 23503', async () => {
    makeService();
    const userId = await seedUser('linked');
    const { documentId, invoiceId, s3Key } = await seedDoc(userId, 'linked', {
      status: DocumentStatus.PARSED,
      invoice: 'linked',
      withJob: true,
    });

    // Before DD-3 this FK-violated: 23503 on FK_998c6b9d2d3f298243299a14d72,
    // the transaction rolled back, and the retention sweep retried forever.
    await expect(service.deleteAccount(userId)).resolves.toEqual({ queuedStorageKeys: 1 });

    await expectTenantGone(userId, [invoiceId!]);
    expect(await ds.getRepository(FieldExtraction).countBy({ document_id: documentId })).toBe(0);
    expect(await ds.getRepository(Job).countBy({ document_id: documentId })).toBe(0);
    expect(s3DeleteFile).toHaveBeenCalledWith(s3Key);
    expect(await ds.getRepository(PendingStorageDeletion).countBy({ s3_key: s3Key })).toBe(0);
  });

  it('deletes a tenant mixing linked, orphan (pointer NULL), and invoice-less documents', async () => {
    makeService();
    const userId = await seedUser('mixed');
    const linked = await seedDoc(userId, 'mixed-linked', {
      status: DocumentStatus.VALIDATED,
      invoice: 'linked',
    });
    const orphan = await seedDoc(userId, 'mixed-orphan', {
      status: DocumentStatus.ERROR,
      invoice: 'orphan',
    });
    const plain = await seedDoc(userId, 'mixed-plain', { status: DocumentStatus.UPLOADED });

    await expect(service.deleteAccount(userId)).resolves.toEqual({ queuedStorageKeys: 3 });

    await expectTenantGone(userId, [linked.invoiceId!, orphan.invoiceId!]);
    expect(await ds.getRepository(Document).countBy({ id: plain.documentId })).toBe(0);
  });

  it('deletes accounts holding documents in every status', async () => {
    makeService();
    const userId = await seedUser('statuses');
    for (const status of Object.values(DocumentStatus)) {
      // Extracted shape for mid-pipeline statuses; bare document for the rest.
      await seedDoc(userId, `status-${status}`, {
        status,
        invoice: status === DocumentStatus.NEEDS_VALIDATION ? 'linked' : undefined,
      });
    }
    expect(await ds.getRepository(Document).countBy({ user_id: userId })).toBe(
      Object.values(DocumentStatus).length,
    );

    await expect(service.deleteAccount(userId)).resolves.toEqual({
      queuedStorageKeys: Object.values(DocumentStatus).length,
    });
    await expectTenantGone(userId);
  });

  it('leaves another user’s tenant untouched (tenant isolation)', async () => {
    makeService();
    const userId = await seedUser('owner');
    const strangerId = await seedUser('stranger');
    const mine = await seedDoc(userId, 'owner-doc', {
      status: DocumentStatus.PARSED,
      invoice: 'linked',
    });
    const theirs = await seedDoc(strangerId, 'stranger-doc', {
      status: DocumentStatus.PARSED,
      invoice: 'linked',
    });

    await expect(service.deleteAccount(userId)).resolves.toEqual({ queuedStorageKeys: 1 });

    await expectTenantGone(userId, [mine.invoiceId!]);
    // The stranger's graph survives untouched — their user, document, invoice,
    // items and pointer all stay, and only the caller's object was purged.
    expect(await ds.getRepository(User).countBy({ id: strangerId })).toBe(1);
    expect(await ds.getRepository(Document).countBy({ id: theirs.documentId })).toBe(1);
    expect(await ds.getRepository(Document).countBy({ id: theirs.documentId, invoiceId: theirs.invoiceId! })).toBe(1);
    expect(await ds.getRepository(Invoice).countBy({ id: theirs.invoiceId! })).toBe(1);
    expect(await ds.getRepository(InvoiceItem).countBy({ invoice_id: theirs.invoiceId! })).toBe(1);
    expect(s3DeleteFile).not.toHaveBeenCalledWith(theirs.s3Key);

    // Leave the DB as this suite found it.
    await service.deleteAccount(strangerId);
  });

  it('keeps the R2 cleanup retryable via pending_storage_deletions when storage fails', async () => {
    makeService();
    const userId = await seedUser('s3-fail');
    const { s3Key } = await seedDoc(userId, 's3-fail', { status: DocumentStatus.PROCESSING });
    s3DeleteFile.mockRejectedValue(new Error('r2 unavailable'));

    // The DB wipe commits and the response must not depend on storage
    // availability — the failed key stays queued for the sweeper.
    await expect(service.deleteAccount(userId)).resolves.toEqual({ queuedStorageKeys: 1 });

    await expectTenantGone(userId);
    const queued = await ds.getRepository(PendingStorageDeletion).findOneByOrFail({ s3_key: s3Key });
    expect(queued.attempts).toBeGreaterThanOrEqual(1);
  });
});
