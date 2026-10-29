// DD-1 regression tests — deleteDocument against a REAL Postgres with the real
// migrated schema. The bug these pin down (FK 23503 → 500 on every delete of an
// extracted document) is invisible to repository-mocked unit tests, which is
// exactly how it reached the deployed demo.
//
// Runs only when TEST_DATABASE_URL points at a throwaway database (migrations
// are applied automatically, the baseline is idempotent). Without the variable
// the whole suite self-skips, so plain `pnpm test` stays green everywhere.
import { DataSource, DataSourceOptions, QueryRunner } from 'typeorm';
import { dataSourceOptions } from '../../database/data-source';
import { User } from '../auth/entities/user.entity';
import { Customer } from './entities/customer.entity';
import { Document, DocumentStatus, DocumentType } from './entities/document.entity';
import { Invoice } from './entities/invoice.entity';
import { InvoiceItem } from './entities/invoice-item.entity';
import { FieldExtraction } from './entities/field-extraction.entity';
import { Job, JobStatus, JobType } from '../jobs/entities/job.entity';
import { AuditLog } from '../jobs/entities/audit-log.entity';
import { PendingStorageDeletion } from '../storage/entities/pending-storage-deletion.entity';
import { StorageCleanupService } from '../storage/services/storage-cleanup.service';
import { S3Service } from '../storage/services/s3.service';
import { DocumentsService } from './documents.service';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const d = TEST_DATABASE_URL ? describe : describe.skip;

d('DocumentsService.deleteDocument (integration, DD-1)', () => {
  let ds: DataSource;
  // Holds the advisory lock for the whole suite — see beforeAll.
  let lockRunner: QueryRunner;
  let service: DocumentsService;
  let s3DeleteFile: jest.Mock;

  const makeService = () => {
    s3DeleteFile = jest.fn(async () => undefined);
    // Real StorageCleanupService over the real pending_storage_deletions table —
    // the retry-queue row IS the contract under test; only R2 itself is mocked.
    const storageCleanup = new StorageCleanupService(
      ds.getRepository(PendingStorageDeletion),
      { deleteFile: s3DeleteFile } as unknown as S3Service,
    );
    service = new DocumentsService(
      ds.getRepository(Document),
      ds.getRepository(Invoice),
      ds.getRepository(InvoiceItem),
      ds.getRepository(FieldExtraction),
      ds.getRepository(AuditLog),
      { add: async () => undefined } as never, // Bull queue — not exercised here
      { deleteFile: s3DeleteFile } as never, // S3Service
      ds,
      {} as never, // QuotaService — not exercised by deleteDocument
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
    // one suite's purge can delete another suite's rows mid-assertion —
    // observed as a ~1-in-5 flake once the second integration suite landed).
    // The session-level advisory lock makes the runs mutually exclusive; a
    // crashed worker releases it implicitly by disconnecting. The lock rides a
    // dedicated query runner so acquire and unlock use the SAME pooled connection.
    lockRunner = ds.createQueryRunner();
    await lockRunner.query(`SELECT pg_advisory_lock(hashtext('doclos-backend-integration'))`);
    await ds.runMigrations(); // idempotent — the baseline skips applied steps
    // Deterministic retry-queue tests: older runs leave rows behind, and
    // purgeQueued() works from the oldest row.
    await ds.getRepository(PendingStorageDeletion).clear();
    makeService();
  });

  afterAll(async () => {
    await lockRunner?.query(`SELECT pg_advisory_unlock(hashtext('doclos-backend-integration'))`);
    await lockRunner?.release();
    await ds?.destroy();
  });

  /** Seed the row graph a processed document has, per scenario. */
  async function seed(
    tag: string,
    opts: {
      status: DocumentStatus;
      withLinkedInvoice?: boolean;
      withOrphanInvoice?: boolean;
      withJob?: boolean;
    },
  ): Promise<{ documentId: string; invoiceId?: string; userId: string; s3Key: string }> {
    const userId = (
      await ds.getRepository(User).save({
        email: `dd1-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`,
        password_hash: 'x',
        name: 'DD1 IT',
      })
    ).id;
    const customerId = (
      await ds.getRepository(Customer).save({ user_id: userId, name: `Supplier ${tag}` })
    ).id;
    const s3Key = `uploads/it/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${tag}.pdf`;
    const documentId = (
      await ds.getRepository(Document).save({
        user_id: userId,
        customer_id: customerId,
        type: DocumentType.INVOICE,
        status: opts.status,
        original_filename: 'doclos-demo-sample.pdf',
        s3_key: s3Key,
        mime_type: 'application/pdf',
        file_size: 1000,
        extraction_confidence: opts.withLinkedInvoice ? 0.9 : null,
      })
    ).id;

    let invoiceId: string | undefined;
    if (opts.withLinkedInvoice || opts.withOrphanInvoice) {
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
      if (opts.withLinkedInvoice) {
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
    return { documentId, invoiceId, userId, s3Key };
  }

  const expectGone = async (documentId: string, invoiceId?: string) => {
    expect(await ds.getRepository(Document).countBy({ id: documentId })).toBe(0);
    expect(await ds.getRepository(Invoice).countBy({ document_id: documentId })).toBe(0);
    if (invoiceId) {
      expect(await ds.getRepository(InvoiceItem).countBy({ invoice_id: invoiceId })).toBe(0);
    }
    expect(await ds.getRepository(FieldExtraction).countBy({ document_id: documentId })).toBe(0);
    expect(await ds.getRepository(Job).countBy({ document_id: documentId })).toBe(0);
  };

  it('deletes a document with an ORPHAN invoice (invoiceId NULL, invoice row alive) — the deployed 500', async () => {
    const { documentId, invoiceId, userId } = await seed('orphan', {
      status: DocumentStatus.NEEDS_VALIDATION,
      withOrphanInvoice: true,
      withJob: true,
    });

    // Before the fix this FK-violated: 23503 on FK_04c08bd4d32a782db66084f7197.
    await expect(service.deleteDocument(documentId, userId)).resolves.toBeUndefined();
    await expectGone(documentId, invoiceId);
  });

  it('deletes a fully processed document (linked invoice, items, extractions, job) and audits it', async () => {
    const { documentId, invoiceId, userId, s3Key } = await seed('linked', {
      status: DocumentStatus.PARSED,
      withLinkedInvoice: true,
      withJob: true,
    });

    await expect(service.deleteDocument(documentId, userId)).resolves.toBeUndefined();
    await expectGone(documentId, invoiceId);
    expect(
      await ds.getRepository(AuditLog).countBy({ entity_id: documentId, action: 'delete' }),
    ).toBe(1);
    expect(s3DeleteFile).toHaveBeenCalledWith(s3Key);
    expect(await ds.getRepository(PendingStorageDeletion).countBy({ s3_key: s3Key })).toBe(0);
  });

  it('deletes sample documents in uploaded and processing status (no extraction artifacts yet)', async () => {
    for (const status of [DocumentStatus.UPLOADED, DocumentStatus.PROCESSING]) {
      const { documentId, userId } = await seed(`fresh-${status}`, { status });
      await expect(service.deleteDocument(documentId, userId)).resolves.toBeUndefined();
      await expectGone(documentId);
    }
  });

  it('deletes an error-status document that also carries an orphan invoice', async () => {
    const { documentId, invoiceId, userId } = await seed('error-orphan', {
      status: DocumentStatus.ERROR,
      withOrphanInvoice: true,
    });

    await expect(service.deleteDocument(documentId, userId)).resolves.toBeUndefined();
    await expectGone(documentId, invoiceId);
  });

  it('still refuses to delete another user’s document (ownership untouched)', async () => {
    const { documentId, userId } = await seed('owner', {
      status: DocumentStatus.PARSED,
      withLinkedInvoice: true,
    });
    const stranger = (
      await ds.getRepository(User).save({
        email: `dd1-stranger-${Date.now()}@example.com`,
        password_hash: 'x',
      })
    ).id;

    await expect(service.deleteDocument(documentId, stranger)).rejects.toMatchObject({
      status: 404,
    });
    expect(await ds.getRepository(Document).countBy({ id: documentId })).toBe(1);
    void userId;
  });

  it('returns success and queues retryable storage cleanup when the R2 delete fails', async () => {
    const { documentId, userId, s3Key } = await seed('s3-fail', {
      status: DocumentStatus.PROCESSING,
    });
    // Both the direct delete and the sweeper's retry attempt fail — the row
    // must survive (with a bumped attempts counter) for the hourly sweeper.
    s3DeleteFile.mockRejectedValue(new Error('r2 unavailable'));

    // DB delete committed + HTTP success must not depend on storage availability.
    await expect(service.deleteDocument(documentId, userId)).resolves.toBeUndefined();
    await expectGone(documentId);
    const queued = await ds.getRepository(PendingStorageDeletion).findOneByOrFail({ s3_key: s3Key });
    expect(queued.attempts).toBeGreaterThanOrEqual(1);
  });
});
