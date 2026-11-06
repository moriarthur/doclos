# Next Session TODO

## Current state (updated 2026-11-06)

- Public demo hardening merged into `main`; PRs #1–#4 all merged:
  - #3 (`fix/account-deletion-fk-order`, fe1abe5): DD-3 — account deletion /
    retention clears `documents."invoiceId"` before deleting invoices.
  - #4 (`fix/smoke-reset-json-body`, e12de1a): smoke script reads JSON bodies
    explicitly in the delete-path assertions.
- `origin/main` = 62a75d1 contains both fixes as separate commits (no history
  rewrite; both original branches stay published).
- Working branch `work/verify-dd3-smoke-fixes` (based on current
  `origin/main`) now carries:
  - `890d70b` — session TODO status update (bookkeeping).
  - `9c7b3e4` — DD-4: the smoke journey covers `DELETE /account` against a
    tenant still holding a processed, invoice-linked sample, plus old-session
    rejection and a survivor-tenant pipeline run (user B). Backend untouched.
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
- DD-4 smoke coverage (commit 9c7b3e4): `node --check` green; every asserted
  status/response shape checked statically against the current backend
  contract — `AccountController` answers 200
  `{ message, storage_objects_queued }`; `JwtStrategy.validate()` and
  `refreshTokens()` both 401 once the user and its refresh sessions are gone;
  the script's cookie jar already echoes the CSRF header on state-changing
  calls; a single run stays within the sample/registration rate budgets (2 of
  2/h/IP sample posts; second run within an hour already trips registration,
  unchanged).

## Not verified (do not assume)

- No live smoke run this session — the deployed environment was untouched, as
  instructed; running it needs explicit confirmation.
- Whether the Render backend has actually deployed `origin/main` (with DD-3 +
  the smoke fix) is unconfirmed from here.
- The earlier "full deployed smoke passed" note predates the smoke-script fix:
  its delete/reset assertions were unreliable, and the smoke never called
  `DELETE /account`, so DD-3 was never covered by any smoke run — consistent
  with DD-3 surfacing in the production logs only after that run.
- DD-3's deployed end-to-end proof is still pending until the updated smoke
  runs against the deployed environment (branch `work/verify-dd3-smoke-fixes`
  or a merge of it must be served there first).

## Open findings (reported, not fixed — audit-first)

- DD-5 (Low, `scripts/smoke-demo.mjs`): `await response.json()` after a
  passing status check throws an unlabeled `SyntaxError` on a non-JSON 2xx
  body (proxy/HTML error page) — the run crashes bare instead of printing a
  labeled FAIL. Cosmetic; documented in `docs/DEMO_DELETE_AUDIT.md`,
  deliberately not fixed in the DD-4 commit.

## Next session

- [ ] Confirm Render deployed `origin/main`; decide whether to merge/push
      `work/verify-dd3-smoke-fixes` (890d70b + 9c7b3e4) so the deployed smoke
      includes the DD-4 account-deletion coverage.
- [ ] With explicit confirmation, run `scripts/smoke-demo.mjs` against the
      deployed frontend (consumes demo quota; creates temporary accounts; the
      run now includes one account deletion).
- [ ] After the deployed run, check backend logs: no 23503/FK errors from the
      retention sweep anymore.
- [ ] Decide on fixing DD-5 (labeled failure for non-JSON bodies) — its own
      commit if approved.
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
  accounts/documents; it now also deletes one account (user A) mid-journey.
