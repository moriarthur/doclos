# Deployed Demo — Delete 500 Findings (DD)

> Branch: `feat/public-demo-hardening` · Date: 2026-10-29
> Trigger: on the deployed demo, `DELETE /api/v1/demo/sample` (Reset sample)
> and the normal document delete button both returned `Internal Server Error`
> for the synthetic sample. Diagnosed read-first against the deployed flow and
> reproduced locally on a throwaway Postgres with the real migrated schema.

## Findings

| ID  | Sev | Finding | Files |
|-----|-----|---------|-------|
| DD-1 | H | `deleteDocument` collected the invoice to delete **only via `documents.invoiceId`**. An **orphan invoice** (row in `invoices` with `document_id` pointing at the document while the pointer is already `NULL`) is invisible to it — the `documents` delete then FK-violates (`23503` on `FK_04c08bd4d32a782db66084f7197`, `invoices.document_id → documents.id`) and **every** delete attempt of that document 500s, on both `DELETE /documents/:id` and `DELETE /demo/sample`. Additionally, a failed R2 delete after the DB commit was only logged — the object was silently orphaned with no retry. | `documents.service.ts`, `storage-cleanup.service.ts` |
| DD-2 | M | Root producer of the orphan: the processor's previous-run cleanup (reprocess path) ran **non-transactionally** — `save(document with invoiceId=NULL)` → items delete → invoice delete. A process death between those statements (Render restart/deploy mid-reprocess) leaves exactly the DD-1 orphan behind. | `document.processor.ts` |

## Fix

- **DD-1**: the delete transaction now finds invoices by `document_id` (mirrors
  `AccountService.deleteAccount`), clears the `invoiceId` pointer only when set,
  deletes items by the collected invoice ids and the invoices by `document_id`.
  Works for documents in any status (`uploaded`, `processing`, `parsed`,
  `needs_validation`, `error`) and heals existing orphans on first delete.
  A failed storage delete now enqueues the key into `pending_storage_deletions`
  (new `StorageCleanupService.enqueue`, `INSERT … OR IGNORE` on the unique
  `s3_key` index) and triggers one immediate purge attempt; the boot/hourly
  sweeper retries. The API response stays a success either way. The 1/day
  sample quota (Redis fixed-window) is untouched by deletion — deleting a
  sample never re-opens the window.
- **DD-2**: the processor cleanup (extractions + invoice teardown) runs inside
  one `dataSource.transaction`, so a crash can no longer produce the orphan.

## Regression coverage

- `documents.service.integration.spec.ts` (new, runs against a real Postgres
  via `TEST_DATABASE_URL`, self-skips otherwise): orphan invoice, linked
  invoice, `uploaded`/`processing`/`error` statuses, ownership 404, storage
  failure → retry-queue row + success.
- `documents.service.spec.ts`: delete-order contract (invoices by
  `document_id`, pointer-clear only when set, retry queue on storage failure).
- `document.processor.spec.ts`: cleanup runs transactionally in FK-safe order.
- `demo.service.spec.ts`: reset performs no quota calls.
- `scripts/smoke-demo.mjs`: post-deploy smoke now covers the per-document
  delete, idempotent reset, and the quota-survives-deletion invariant.

## Verification

Local (2026-10-29): repro script against the migrated schema — orphan delete
FK-violated (23503) before the fix, succeeds after; backend `tsc --noEmit`,
eslint, 189/189 jest (incl. 6 integration on real Postgres), `nest build` green.
