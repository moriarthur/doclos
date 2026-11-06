# Next Session TODO

## Current state (updated 2026-11-06)

- Public demo hardening merged into `main`; PRs #1–#5 all merged:
  - #3 (`fix/account-deletion-fk-order`, fe1abe5): DD-3 — account deletion /
    retention clears `documents."invoiceId"` before deleting invoices.
  - #4 (`fix/smoke-reset-json-body`, e12de1a): smoke script reads JSON bodies
    explicitly in the delete-path assertions.
  - #5 (`fix/rls-internal-tables`, a766e97): RLS-1 — row-level security
    enabled on `refresh_sessions` and `pending_storage_deletions`.
- `origin/main` = e7960ed (merge of #5) contains the DD-3 and smoke fixes as
  separate commits; both original branches stay published.
- Working branch `work/verify-dd3-smoke-fixes` — rebased onto current
  `origin/main` (e7960ed), 5 commits ahead:
  - `10dbb6a` — session TODO status update (bookkeeping).
  - `a910a3d` — DD-4: the smoke journey covers `DELETE /account` against a
    tenant still holding a processed, invoice-linked sample, plus old-session
    rejection and a survivor-tenant pipeline run (user B). Backend untouched.
  - `ff5838b` — session TODO status update (bookkeeping).
  - `a242cfa` — DD-6 (auditor finding on DD-4): post-deletion 401s are now
    proven with a pinned, proven-live pre-deletion cookie copy (plus live
    controls), not via the live jar. Backend untouched.
  - `83f30d7` — session TODO status update (bookkeeping).
- Deployed environment (confirmed):
  - Render backend runs from `main` at e7960ed; frontend live.
  - `/healthz` and `/readyz` green.
  - The RLS migration `EnableRlsOnInternalTables` (1793923200000) was applied
    to the Supabase production database via `pnpm db:migrate`; the Supabase
    Advisor warnings for `refresh_sessions` and `pending_storage_deletions`
    are gone.
  - Supabase, Upstash Redis, Cloudflare R2 and Z.ai Standard API configured.
- The local `codex_audit` file stays untracked and out of commits.

## Verified locally (2026-11-06)

On `work/verify-dd3-smoke-fixes`:

- Backend `tsc --noEmit`, eslint, `nest build`: green (run before the RLS-1
  merge; `tsc --noEmit` re-run green after the rebase, see below).
- Jest with `TEST_DATABASE_URL` against a throwaway local Postgres (clean DB,
  migrations applied by the suites):
  - **195/195 tests, 22 suites** (11 integration) — the original run on this
    branch **before** the RLS-1 merge/rebase.
  - **205/205 tests, 23 suites** — re-run on this branch (597dd3f tree)
    **after** the rebase onto e7960ed, so the RLS migration spec is included;
    `tsc --noEmit` green in the same run.
- DD-3 regression proof: with the fix reverted in the working tree (not
  committed), 4/5 account-deletion integration tests fail with the production
  error verbatim (23503 on `FK_998c6b9d2d3f298243299a14d72`); with the fix,
  green again.
- DD-4 smoke coverage (commit a910a3d): `node --check` green; every asserted
  status/response shape checked statically against the current backend
  contract — `AccountController` answers 200
  `{ message, storage_objects_queued }`; `JwtStrategy.validate()` and
  `refreshTokens()` both 401 once the user and its refresh sessions are gone;
  the script's cookie jar already echoes the CSRF header on state-changing
  calls; a single run stays within the sample/registration rate budgets (2 of
  2/h/IP sample posts; second run within an hour already trips registration,
  unchanged).
- DD-6 hardening (commit a242cfa): `node --check` green; the control pairs
  verified statically — live-session refresh → 200 (rotation), the pinned
  copy → 200 on `GET /documents` pre-deletion, → 401 on refresh and API
  post-deletion via `callWithCookies()` (never absorbs responses).

On `fix/rls-internal-tables` (a766e97, pre-merge, recorded in the RLS-1
report — not attributed to this branch):

- **205/205 tests, 23 suites** incl. integration, plus clean-DB double
  migrate, revert scope, restricted-role refusal and a live boot check.

## Not verified (do not assume)

- **No live smoke run yet** — the deployed environment was not touched by the
  smoke; running it needs explicit confirmation.
- The deployed smoke still runs the pre-DD-4 script: DD-4/DD-6 live only on
  `work/verify-dd3-smoke-fixes`, which is **not pushed or merged**. Until
  this branch lands on `main`, a deployed smoke cannot cover the
  account-deletion path.
- The earlier "full deployed smoke passed" note predates the smoke-script fix:
  its delete/reset assertions were unreliable, and the smoke never called
  `DELETE /account`, so DD-3 was never covered by any smoke run — consistent
  with DD-3 surfacing in the production logs only after that run.
- DD-3's deployed end-to-end proof therefore remains pending until the
  updated smoke runs against the deployed environment.

## Open findings (reported, not fixed — audit-first)

- DD-5 (Low, `scripts/smoke-demo.mjs`): `await response.json()` after a
  passing status check throws an unlabeled `SyntaxError` on a non-JSON 2xx
  body (proxy/HTML error page) — the run crashes bare instead of printing a
  labeled FAIL. Cosmetic; documented in `docs/DEMO_DELETE_AUDIT.md`,
  deliberately not fixed in the DD-4 commit.

## Next session

- [ ] Decide whether to push/merge `work/verify-dd3-smoke-fixes`
      (a910a3d + a242cfa) so the deployed smoke includes the DD-4/DD-6
      account-deletion coverage.
- [ ] After that lands, run `scripts/smoke-demo.mjs` against the deployed
      frontend with explicit confirmation (consumes demo quota; creates
      temporary accounts; the run includes one account deletion).
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
