# Deployed Demo — Delete 500 Findings (DD)

> Branch: `feat/public-demo-hardening` · Date: 2026-10-29
> Trigger: on the deployed demo, `DELETE /api/v1/demo/sample` (Reset sample)
> and the normal document delete button both returned `Internal Server Error`
> for the synthetic sample. Diagnosed read-first against the deployed flow and
> reproduced locally on a throwaway Postgres with the real migrated schema.
> Follow-up (2026-10-29, after the PR #2 merge): DD-3 — the same FK class of
> defect in the account-deletion/retention path, found in the deployed
> backend's logs.
> Follow-up (2026-11-06): DD-4 — none of the smoke journeys ever called
> `DELETE /api/v1/account`, so the DD-3 path had no deployed coverage at all
> (which is why DD-3 surfaced only in the production logs). DD-5 — a Low
> robustness nit in the same script, documented but intentionally not fixed
> in the DD-4 commit. DD-6 — same day, auditor review of the DD-4 commit:
> its post-deletion 401 checks read the live cookie jar and could 401 for
> the wrong reason; fixed by replaying a pinned, proven-live cookie copy.
> Deployed smoke (2026-11-06, main c1534db): all steps passed — the DD-3
> account-deletion path is covered end-to-end on the deployed demo (see
> Verification). The retention sweep itself was not observed there.

## Findings

| ID  | Sev | Finding | Files |
|-----|-----|---------|-------|
| DD-1 | H | `deleteDocument` collected the invoice to delete **only via `documents.invoiceId`**. An **orphan invoice** (row in `invoices` with `document_id` pointing at the document while the pointer is already `NULL`) is invisible to it — the `documents` delete then FK-violates (`23503` on `FK_04c08bd4d32a782db66084f7197`, `invoices.document_id → documents.id`) and **every** delete attempt of that document 500s, on both `DELETE /documents/:id` and `DELETE /demo/sample`. Additionally, a failed R2 delete after the DB commit was only logged — the object was silently orphaned with no retry. | `documents.service.ts`, `storage-cleanup.service.ts` |
| DD-2 | M | Root producer of the orphan: the processor's previous-run cleanup (reprocess path) ran **non-transactionally** — `save(document with invoiceId=NULL)` → items delete → invoice delete. A process death between those statements (Render restart/deploy mid-reprocess) leaves exactly the DD-1 orphan behind. | `document.processor.ts` |
| DD-3 | H | `AccountService.deleteAccount` (also the **entire demo retention path** — `DemoRetentionService` calls it per account) deleted the invoices **before clearing `documents."invoiceId"`**. The circular FK (`FK_998c6b9d2d3f298243299a14d72`, `documents."invoiceId" → invoices.id`, `ON DELETE NO ACTION`) FK-violated (`23503` on `update or delete on table "invoices" … on table "documents"`) for every account holding an extracted invoice: the transaction rolled back, `DELETE /account` 500ed, and the retention sweep re-logged the failure for the same accounts on every run — they could never be purged. The DD-1 ordering fix covered only the per-document delete. | `account.service.ts` |
| DD-4 | M | Coverage gap: `scripts/smoke-demo.mjs` exercised registration, the pipeline, the per-document delete and the reset — but never `DELETE /api/v1/account`. The account-wide teardown (self-service deletion AND the retention sweep — one code path) had zero deployed coverage, so the DD-3 regression shipped green. | `scripts/smoke-demo.mjs` |
| DD-5 | Low | In the smoke script every `await response.json()` sits after a passing status check; a 2xx response with a non-JSON body (proxy error page, HTML) throws an unlabeled `SyntaxError` — the run crashes with a bare message instead of a labeled `FAIL` step. Cosmetic robustness only; every JSON assertion itself is correct. Open — deliberately not fixed in the DD-4 commit. | `scripts/smoke-demo.mjs` |
| DD-6 | M | The DD-4 post-deletion checks (`refresh → 401`, `GET /documents → 401`) drove requests through the live cookie jar. `call()` rewrites the jar from every response, so if `DELETE /account` ever returned `Set-Cookie` clearers, the jar would be empty and both requests would 401 **because no credentials were sent** — the run would look green while proving nothing about server-side revocation. Today's `AccountController` sends no `Set-Cookie`, so the original DD-4 run passed for the right reason by coincidence of the current response shape; the coverage must not depend on that. | `scripts/smoke-demo.mjs` |

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
- **DD-4**: the smoke journey now deletes the account that still owns the
  fully processed sample with its extracted invoice — the exact DD-3 tenant
  shape — then proves the old session dead server-side (as hardened by DD-6
  below). The per-document teardown (DD-1), reset, quota and
  logout/revocation checks moved to the surviving user B, who loads their own
  sample first — also proving the pipeline keeps working for another tenant
  after a deletion. Backend code is untouched by this fix; no new rate
  budgets are exceeded in a single run (sample posts per run: 2 of the
  2/h/IP budget; the second run within an hour already trips the 3/h/IP
  registration budget, unchanged; the DD-6 refresh control adds one call to
  the 10/min/IP auth budget, far under the limit).
- **DD-6**: the post-deletion 401 assertions no longer ride the live jar.
  Before `DELETE /account`, the script (a) refreshes with the live session —
  expecting 200, which also rotates A's cookies so the snapshot taken next
  holds the rotation's still-live session, and (b) snapshots A's cookies
  (access + refresh + csrf) and proves that exact copy opens the API with a
  200 — the required "a valid session gets non-401" control. After the
  deletion, the pinned copy is replayed via the new `callWithCookies()`
  helper, which builds the header from the snapshot and never absorbs
  responses: refresh → 401 and `GET /documents` → 401. Since the identical
  copy answered 200 seconds earlier, the 401s can only come from the server
  invalidating the deleted account's session (`refreshTokens()` session
  lookup + user-existence re-check; `JwtStrategy.validate()` user lookup) —
  not from missing client-side credentials.

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
  delete, idempotent reset, and the quota-survives-deletion invariant — plus,
  since DD-4, the full account-deletion path (`DELETE /account` against a
  tenant still holding a processed, invoice-linked sample; refresh and API
  rejection of a pinned, proven-live pre-deletion cookie copy — DD-6) and a
  survivor-tenant pipeline run (user B's own sample) after that deletion.

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

DD-4 (2026-11-06, local): `node --check` on the updated script; every
expected status/response shape verified statically against the current
backend contract (`AccountController` → 200 `{ message, storage_objects_queued }`;
`JwtStrategy.validate()` and `refreshTokens()` both 401 after the user row /
session rows are gone; CSRF double-submit handled by the script's cookie jar).

DD-6 (2026-11-06, local): `node --check` green; the control pairs verified
statically against the current contract (live-session refresh → 200 by
`refreshTokens()` rotation; the pinned copy → 200 pre-deletion by
`JwtStrategy.validate()`, → 401 post-deletion once the user/session rows are
gone).

Deployed smoke (2026-11-06, main c1534db, after the PR #6 merge):
`All smoke steps passed.` against the deployed frontend.
`/healthz` and `/readyz` green (postgres, redis, storage all `ok`); the full
journey — two isolated users, tenant isolation, GLM pipeline, R2 download,
Excel export — green. The DD-3 path ran end-to-end on the deployed demo:
`DELETE /account` returned 200 for the account still holding the processed,
invoice-linked sample, and the DD-6 pinned pre-deletion cookies answered 200
on refresh and API right before the deletion and 401 on both after it —
server-side session invalidation proven live, not an emptied jar. The
surviving tenant then processed its own sample through the pipeline and the
per-document delete, idempotent reset, quota-survives-deletion and
logout/revocation checks all held. No credentials, cookies, emails or
document IDs were recorded. **Scope note:** this run exercised the
self-service `DELETE /account` entry (the same `AccountService.deleteAccount`
the retention sweep calls); the sweep's own behavior on the deployed backend
was not observed and its logs were not reviewed — the sweep is verified only
by the unit/integration suites.
