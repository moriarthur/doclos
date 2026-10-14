import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { RefreshSession } from './entities/refresh-session.entity';
import { Document } from '../documents/entities/document.entity';
import { Invoice } from '../documents/entities/invoice.entity';
import { InvoiceItem } from '../documents/entities/invoice-item.entity';
import { FieldExtraction } from '../documents/entities/field-extraction.entity';
import { Customer } from '../documents/entities/customer.entity';
import { Job } from '../jobs/entities/job.entity';
import { AuditLog } from '../jobs/entities/audit-log.entity';
import { PendingStorageDeletion } from '../storage/entities/pending-storage-deletion.entity';
import { StorageCleanupService } from '../storage/services/storage-cleanup.service';

// PD-T1 (public-demo audit): DELETE /api/v1/account — the whole tenant
// disappears in one transaction (documents, invoices + items, extractions,
// jobs, customers, audit logs, sessions, the user row itself), while the
// R2 objects go through the pending_storage_deletions retry queue so a
// storage blip can never leave the account "deleted but still stored".
//
// Scoped strictly by user_id: another user's rows are untouched by
// construction (every DELETE carries the owner predicate).
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    @InjectRepository(User)
    usersRepository: Repository<User>,
    @InjectRepository(Document)
    private readonly documentsRepository: Repository<Document>,
    private readonly dataSource: DataSource,
    private readonly storageCleanupService: StorageCleanupService,
  ) {
    // The user row is erased inside the transaction via the manager — the
    // repository injection exists to satisfy TypeORM DI for the entity.
    void usersRepository;
  }

  /**
   * Delete the caller's account. Returns the storage keys queued for
   * deletion (they are purged immediately when possible, retried by the
   * sweeper otherwise).
   */
  async deleteAccount(userId: string): Promise<{ queuedStorageKeys: number }> {
    // Collect the storage keys BEFORE the transaction — the rows they point
    // at are about to disappear.
    const documents = await this.documentsRepository.find({
      where: { user_id: userId },
      select: ['id', 's3_key'],
    });
    const s3Keys = documents.map((d) => d.s3_key);

    await this.dataSource.transaction(async (manager) => {
      const documentIds = documents.map((d) => d.id);

      if (documentIds.length > 0) {
        const invoices = await manager.find(Invoice, {
          where: { document_id: In(documentIds) },
          select: ['id'],
        });
        const invoiceIds = invoices.map((i) => i.id);

        if (invoiceIds.length > 0) {
          await manager.delete(InvoiceItem, { invoice_id: In(invoiceIds) });
          await manager.delete(Invoice, { id: In(invoiceIds) });
        }
        await manager.delete(FieldExtraction, { document_id: In(documentIds) });
        await manager.delete(Job, { document_id: In(documentIds) });
      }

      await manager.delete(Document, { user_id: userId });
      await manager.delete(Customer, { user_id: userId });
      await manager.delete(AuditLog, { user_id: userId });
      await manager.delete(RefreshSession, { user_id: userId });

      // The retry queue commits atomically with the wipe: if the process dies
      // right after, the sweeper still finds the keys.
      for (const key of s3Keys) {
        await manager
          .createQueryBuilder()
          .insert()
          .into(PendingStorageDeletion)
          .values({ s3_key: key })
          .orIgnore()
          .execute();
      }

      await manager.delete(User, { id: userId });
    });

    this.logger.log(`Account deleted: user ${userId}, ${s3Keys.length} storage object(s) queued`);

    // Best-effort immediate purge; anything that fails stays queued for the
    // sweeper (observable as rows, retried at boot + hourly).
    await this.storageCleanupService.purgeQueued();

    return { queuedStorageKeys: s3Keys.length };
  }
}
