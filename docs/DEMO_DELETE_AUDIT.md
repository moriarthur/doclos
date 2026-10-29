# Deployed Demo — Delete 500 Findings (DD)

> Branch: `feat/public-demo-hardening` · Date: 2026-10-29
> Trigger: on the deployed demo, `DELETE /api/v1/demo/sample` (Reset sample)
> and the normal document delete button both returned `Internal Server Error`
> for the synthetic sample. Diagnosed read-first against the deployed flow and
> reproduced locally on a throwaway Postgres with the real migrated schema.
> Follow-up (2026-10-29, after the PR #2 merge): DD-3 — the same FK class of
> defect in the account-deletion/retention path, found in the deployed
> backend's logs.

## Findings

| ID  | Sev | Finding | Files |
|-----|-----|---------|-------|
| DD-1 | H | `deleteDocument` collected the invoice to delete **only via `documents.invoiceId`**. An **orphan invoice** (row in `invoices` with `document_id` pointing at the document while the pointer is already `NULL`) is invisible to it — the `documents` delete then FK-violates (`23503` on `FK_04c08bd4d32a782db66084f7197`, `invoices.document_id → documents.id`) and **every** delete attempt of that document 500s, on both `DELETE /documents/:id` and `DELETE /demo/sample`. Additionally, a failed R2 delete after the DB commit was only logged — the object was silently orphaned with no retry. | `documents.service.ts`, `storage-cleanup.service.ts` |
| DD-2 | M | Root producer of the orphan: the processor's previous-run cleanup (reprocess path) ran **non-transactionally** — `save(document with invoiceId=NULL)` → items delete → invoice delete. A process death between those statements (Render restart/deploy mid-reprocess) leaves exactly the DD-1 orphan behind. | `document.processor.ts` |
| DD-3 | H | `AccountService.deleteAccount` (also the **entire demo retention path** — `DemoRetentionService` calls it per account) deleted the invoices **before clearing `documents."invoiceId"`**. The circular FK (`FK_998c6b9d2d3f298243299a14d72`, `documents."invoiceId" → invoices.id`, `ON DELETE NO ACTION`) FK-violated (`23503` on `update or delete on table "invoices" … on table "documents"`) for every account holding an extracted invoice: the transaction rolled back, `DELETE /account` 500ed, and the retention sweep re-logged the failure for the same accounts on every run — they could never be purged. The DD-1 ordering fix covered only the per-document delete. | `account.service.ts` |

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
- **DD-3**: the account-deletion transaction now clears the
  `documents."invoiceId"` pointers (`UPDATE documents SET "invoiceId" = NULL
  WHERE user_id = …`, caller-scoped) BEFORE deleting invoice items and
  invoices — the same rule the per-document path has followed since DD-1.
  Correct for linked invoices, DD-1 orphans (already collected by
  `document_id`), invoice-less documents and every document status. Tenant
  isolation, the `pending_storage_deletions` retry queue and quota semantics
  are unchanged; no schema change, so no migration.

## Regression coverage

- `documents.service.integration.spec.ts` (new, runs against a real Postgres
  via `TEST_DATABASE_URL`, self-skips otherwise): orphan invoice, linked
  invoice, `uploaded`/`processing`/`error` statuses, ownership 404, storage
  failure → retry-queue row + success.
- `account.service.spec.ts`: the DD-3 pointer-clear is caller-scoped, carries
  `invoiceId: null` and runs before the invoice deletes; skipped entirely when
  the tenant has no documents.
- `account.service.integration.spec.ts` (new, real Postgres via
  `TEST_DATABASE_URL`, self-skips otherwise): the production shape (linked
  invoice + items + extraction + job — FK-violated before the fix), a mixed
  linked/orphan/invoice-less tenant, every document status, stranger-tenant
  isolation, storage failure → retry-queue row + success.
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

DD-3 (2026-10-29): with the fix reverted, the new account integration suite
fails with the production error verbatim (23503 on
`FK_998c6b9d2d3f298243299a14d72`); with the fix, `tsc --noEmit`, eslint,
195/195 jest (incl. 11 integration on real Postgres — green across 6
consecutive runs; the two DB suites now serialize on a Postgres advisory lock,
which removed a ~1-in-5 cross-suite flake on the shared retry table),
clean-DB migration gate applied twice, `nest build` green.
