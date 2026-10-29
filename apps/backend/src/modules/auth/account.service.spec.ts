import { AccountService } from './account.service';

// PD-T1: self-service account deletion — one transaction erases the caller's
// tenant; every other user's data is untouched; storage keys land in the
// retry queue.
describe('AccountService.deleteAccount', () => {
  type Doc = { id: string; user_id: string; s3_key: string };

  const makeHarness = (docs: Doc[]) => {
    const calls: Array<{ op: string; target: unknown; criteria?: unknown }> = [];
    const manager = {
      find: async () => docs.map((d) => ({ id: `inv-${d.id}` })),
      delete: async (target: unknown, criteria: unknown) => {
        calls.push({ op: 'delete', target, criteria });
      },
      createQueryBuilder: () => ({
        insert: () => ({
          into: () => ({
            values: () => ({
              orIgnore: () => ({
                execute: async () => {
                  calls.push({ op: 'queue-storage', target: null });
                },
              }),
            }),
          }),
        }),
      }),
    };
    const dataSource = {
      transaction: async (fn: (m: typeof manager) => Promise<void>) => fn(manager),
    };

    const purgeQueued = jest.fn(async () => 0);
    const service = Object.create(AccountService.prototype) as AccountService;
    Object.defineProperty(service, 'usersRepository', {
      value: {},
      configurable: true,
    });
    // Respect the user_id predicate exactly like the real repository would —
    // scoping is what this test is about.
    Object.defineProperty(service, 'documentsRepository', {
      value: {
        find: async (criteria?: { where?: { user_id?: string } }) =>
          docs.filter((d) => !criteria?.where?.user_id || d.user_id === criteria.where.user_id),
      },
      configurable: true,
    });
    Object.defineProperty(service, 'dataSource', { value: dataSource, configurable: true });
    Object.defineProperty(service, 'storageCleanupService', {
      value: { purgeQueued },
      configurable: true,
    });
    Object.defineProperty(service, 'logger', {
      value: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
      configurable: true,
    });
    return { service, calls, purgeQueued };
  };

  it('erases every user-owned table and queues the storage keys', async () => {
    const docs: Doc[] = [
      { id: 'd1', user_id: 'u1', s3_key: 'uploads/2026/10/15/a.pdf' },
      { id: 'd2', user_id: 'u1', s3_key: 'uploads/2026/10/15/b.pdf' },
    ];
    const { service, calls, purgeQueued } = makeHarness(docs);

    const result = await service.deleteAccount('u1');

    expect(result.queuedStorageKeys).toBe(2);
    // Invoice chain (items, invoices), extractions, jobs (4) + documents,
    // customers, audit logs, sessions, user (5) = 9 deletes.
    const deletedTargets = calls.filter((c) => c.op === 'delete');
    expect(deletedTargets).toHaveLength(9);
    // The storage keys are queued INSIDE the same transaction.
    expect(calls.filter((c) => c.op === 'queue-storage')).toHaveLength(2);
    // Immediate best-effort purge runs after commit.
    expect(purgeQueued).toHaveBeenCalledTimes(1);
  });

  it('scoped strictly to the caller — another user’s rows and objects are untouched', async () => {
    const docs: Doc[] = [
      { id: 'd1', user_id: 'u1', s3_key: 'uploads/a.pdf' },
      { id: 'other', user_id: 'u2', s3_key: 'uploads/b.pdf' },
    ];
    const { service, calls } = makeHarness(docs);

    await service.deleteAccount('u1');

    // Only u1's storage key is queued.
    expect(calls.filter((c) => c.op === 'queue-storage')).toHaveLength(1);
    // The document wipe carries the owner predicate.
    const documentDelete = calls.find(
      (c) => c.op === 'delete' && (c.target as { name?: string })?.name === 'Document',
    );
    expect(documentDelete?.criteria).toEqual({ user_id: 'u1' });
  });

  it('an account without documents deletes cleanly and queues nothing', async () => {
    const { service, calls } = makeHarness([]);
    const result = await service.deleteAccount('u1');
    expect(result.queuedStorageKeys).toBe(0);
    expect(calls.filter((c) => c.op === 'queue-storage')).toHaveLength(0);
    // Documents, customers, audit logs, sessions, user — no invoice chain.
    expect(calls.filter((c) => c.op === 'delete')).toHaveLength(5);
  });
});
