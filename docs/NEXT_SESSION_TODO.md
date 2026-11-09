# Next Session TODO

## Current state (updated 2026-11-07, after RLS-2 reached production)

- Public demo hardening merged into `main`; PRs #1–#9 all merged:
  - #3 (`fix/account-deletion-fk-order`, fe1abe5): DD-3 — account deletion /
    retention clears `documents."invoiceId"` before deleting invoices.
  - #4 (`fix/smoke-reset-json-body`, e12de1a): smoke script reads JSON bodies
    explicitly in the delete-path assertions.
  - #5 (`fix/rls-internal-tables`, a766e97): RLS-1 — row-level security
    enabled on `refresh_sessions` and `pending_storage_deletions`.
  - #6 (`work/verify-dd3-smoke-fixes`, merge c1534db): DD-4 (`a910a3d`) — the
    smoke journey covers `DELETE /account` against a tenant still holding a
    processed, invoice-linked sample; DD-6 (`a242cfa`) — post-deletion 401s
    are proven with a pinned, proven-live pre-deletion cookie copy. Backend
    untouched by both.
  - #9 (`fix/rls-2-clean-db-rls`, 6f35c21, merge 98126f5): RLS-2 — the
    migration chain now ENABLEs row-level security on EVERY public base
    table (idempotent, same role preflight, no policies, no grants,
    deliberately irreversible `down()`). Closes the clean-replay gap: a
    fresh database used to end with RLS on only 2 of 11 public tables — the
    other 9 were reachable through the Supabase Data API (PostgREST, anon
    key) subject to grants alone; the full lockdown existed only where the
    one-off `enable-rls.cjs` had been run. The CI `migrations` job now
    asserts the property (zero public tables without RLS) after a clean
    double migrate.
- `main` = 98126f5.
- **Deployed smoke PASSED (2026-11-06, main c1534db; last confirmed
  deployed run before RLS-2 reached production)** against
  `https://doclos-frontend.onrender.com`:
  - `/healthz` and `/readyz` green; postgres, redis, storage all `ok`.
  - Registration + login of two isolated users, tenant isolation, GLM
    pipeline, R2 download and Excel export — green.
  - Account deletion (DD-3 path): `DELETE /account` against a tenant still
    holding a processed, invoice-linked sample → 200; the pinned
    pre-deletion cookies answered 200 on refresh and API before the deletion
    and 401 on both after it (DD-6 proof live).
  - The surviving user processed their own sample through the pipeline;
    per-document delete, idempotent reset, quota-survives-deletion, logout
    and revoked-session rejection — green.
- Deployed environment (confirmed):
  - Render backend runs from `main`; frontend live at
    `https://doclos-frontend.onrender.com`.
  - The RLS migration `EnableRlsOnInternalTables` (1793923200000) was applied
    to the Supabase production database via `pnpm db:migrate`; the Supabase
    Advisor warnings for `refresh_sessions` and `pending_storage_deletions`
    are gone.
  - RLS-2 deployed (PR #9, 2026-11-07): `EnableRlsOnAllPublicTables`
    (1794806400000) was applied manually with `pnpm db:migrate` after merge;
    the backend is on Render Free and has no pre-deploy command.
    ALL 11 public tables now have row-level security enabled
    (`relrowsecurity = true`, `relforcerowsecurity = false` — intentional:
    the app connects as the owning/BYPASSRLS role and never uses the Data
    API), with zero policies and no grant changes. Supabase Advisor is
    clean — no `rls_disabled_in_public` warnings remain.
  - Supabase, Upstash Redis, Cloudflare R2 and Z.ai Standard API configured.
- The local `codex_audit` file stays untracked and out of commits.

## Verified locally (2026-11-06, before the merge)

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

On `fix/rls-2-clean-db-rls` (6f35c21, pre-merge):

- **215/215 tests, 24 suites** incl. integration (205 prior + 10 new unit
  checks pinning the RLS-2 SQL contract); `tsc --noEmit` and eslint green.
- Disposable Postgres 16: clean replay → RLS on **11/11** public tables
  (double migrate, second pass no-op); replaying the same migration on a
  script-protected (production-like) database → no-op, state unchanged;
  forced `migration:revert` on the protected DB throws before any DDL and
  leaves RLS 11/11 with the migrations ledger intact; grants untouched (77
  `role_table_grants` rows before/after).

## Not verified (do not assume)

- **The retention sweep has not been directly verified.** The deployed logs
  show the sweep is enabled (switched on), but there is NO record of an
  actual sweep run or its result — do not claim the sweep itself was
  observed. The deployed smoke exercised the shared self-service
  `DELETE /account` path (the same `AccountService.deleteAccount` the sweep
  calls), which is not the same thing.
- The earlier "full deployed smoke passed" note predates the smoke-script
  fix: its delete/reset assertions were unreliable, and before 2026-11-06 the
  smoke had never called `DELETE /account` — consistent with DD-3 surfacing
  in the production logs only after that earlier run. The 2026-11-06 run
  above is the first one with correct assertions and account-deletion
  coverage.

## Open findings (reported, not fixed — audit-first)

- DD-5 (Low, `scripts/smoke-demo.mjs`): `await response.json()` after a
  passing status check throws an unlabeled `SyntaxError` on a non-JSON 2xx
  body (proxy/HTML error page) — the run crashes bare instead of printing a
  labeled FAIL. Cosmetic; documented in `docs/DEMO_DELETE_AUDIT.md`,
  deliberately not fixed in the DD-4 commit. Still open as of 2026-11-07.
- PD-D4 (found 2026-11-09, retention audit): accounts that registered but
  never logged in were invisible to the retention sweep forever — the
  candidate filter compared `last_login < cutoff` only, and SQL
  `NULL < cutoff` is never true, while registration never sets `last_login`.
  **Fixed on branch `fix/retention-null-last-login`** (never-logged-in
  accounts now age from `created_at`; unit + integration tests added) — not
  yet reviewed, merged or deployed; production still runs the old behavior.

## Next session

- [ ] Codex review + merge `fix/retention-null-last-login` (PD-D4), then
      deploy so the sweep actually reaps never-logged-in demo signups.
- [ ] Retention sweep: enabled in the deployed logs, but no sweep run or
      its result has been recorded yet — capture one next session.
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
  accounts/documents; it also deletes one account (user A) mid-journey.
