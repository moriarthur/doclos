# Next Session TODO

## Current state (updated 2026-11-06)

- Public demo hardening merged into `main`; PRs #1–#4 all merged:
  - #3 (`fix/account-deletion-fk-order`, fe1abe5): DD-3 — account deletion /
    retention clears `documents."invoiceId"` before deleting invoices.
  - #4 (`fix/smoke-reset-json-body`, e12de1a): smoke script reads JSON bodies
    explicitly in the delete-path assertions.
- `origin/main` = 62a75d1 contains both fixes as separate commits (no history
  rewrite; both original branches stay published).
- Working branch `work/verify-dd3-smoke-fixes` (based on `origin/main`) carries
  both fixes plus this TODO update.
- Render backend/frontend: live. Supabase, Upstash Redis, Cloudflare R2 and
  Z.ai Standard API are configured. `/healthz` and `/readyz` passed earlier.
- Migrations applied successfully on the deployed database.

## Verified locally (2026-11-06, on `work/verify-dd3-smoke-fixes`)

- Backend `tsc --noEmit`, eslint, `nest build`: green.
- Jest with `TEST_DATABASE_URL` against a throwaway local Postgres (clean DB,
  migrations applied by the suites): 195/195 tests, 22/22 suites, including
  11 integration tests.
- DD-3 regression proof: with the fix reverted in the working tree (not
  committed), 4/5 account-deletion integration tests fail with the production
  error verbatim (23503 on `FK_998c6b9d2d3f298243299a14d72`); with the fix,
  green again.
- DD-3 semantics re-checked in code: caller-scoped pointer-clear
  (`UPDATE documents SET "invoiceId" = NULL WHERE user_id = …`) runs inside the
  deletion transaction, before the invoice-item and invoice deletes; invoices
  are collected by `document_id` (orphan invoices covered); both
  `DELETE /account` and the retention sweep (`DemoRetentionService.sweep`) ride
  the same fixed path.
- Integration coverage confirmed: linked invoice, orphan invoice (pointer
  NULL), invoice-less documents, every document status, stranger-tenant
  isolation, storage failure → retry queue + success.
- Smoke script: `node --check` OK; delete-path assertions now parse bodies
  explicitly via `response.json()` after the status check — the old
  `response.body?.x` pattern (undefined on a fetch stream: the list check
  passed vacuously, the reset check boomed spuriously) is fully gone; the
  reset assertion shape `{ deleted: number }` matches `DemoService.resetSample`.

## Not verified (do not assume)

- No live smoke run this session — the deployed environment was untouched, as
  instructed; running it needs explicit confirmation.
- Whether the Render backend has actually deployed `origin/main` (with DD-3 +
  the smoke fix) is unconfirmed from here.
- The earlier "full deployed smoke passed" note predates the smoke-script fix:
  its delete/reset assertions were unreliable, and the smoke never calls
  `DELETE /account`, so DD-3 was never covered by any smoke run — consistent
  with DD-3 surfacing in the production logs only after that run.

## New findings (reported, not fixed — audit-first)

- M: the smoke script does not exercise `DELETE /api/v1/account` — the exact
  DD-3 path. Suggested follow-up: add an account-deletion step at the end of
  the journey (after the revocation checks); own commit after a decision.
- Low: in smoke step 10a, `response.json()` after a passing status check would
  throw an unlabeled error on a non-JSON body (crash instead of a labeled
  FAIL). Cosmetic robustness only.

## Next session

- [ ] Confirm Render deployed `origin/main` (62a75d1); check `/readyz` and
      recent backend logs there.
- [ ] With explicit confirmation, run `scripts/smoke-demo.mjs` against the
      deployed frontend (consumes demo quota; creates temporary accounts).
- [ ] Decide on the smoke `DELETE /account` step (finding above).
- [ ] Decide whether to add a custom domain.
- [ ] Confirm the 14-day demo retention setting remains intentional.
- [ ] Schedule periodic rotation of Z.ai, R2, JWT and Redis credentials.
- [ ] Review R2 bucket contents and remove only confirmed obsolete test
      objects, if desired.
- [ ] Consider upgrading the backend from Render Free if cold starts or
      outbound-traffic limits become a problem.

## Guardrails

- Do not run destructive database commands against production.
- Do not run the smoke against production without explicit confirmation.
- Do not commit `.env`, credentials or the local `codex_audit` file.

## Known behavior

- Render Free services sleep after inactivity; the first request can be slow.
- Resetting a synthetic sample does not reset the `1 sample/day/user` quota.
- The smoke test consumes demo quota and creates temporary test
  accounts/documents.
