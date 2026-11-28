# Next Session TODO

## Current state (updated 2026-11-28, evening: extraction display + DD-5 fixed, keep-alive decided)

- **Extraction display finding FIXED (2026-11-28, `bf62bd1`, main
  `e95da1e`; merged without codex/PR by lead decision — CI runs on the
  main push too).** Root cause: `GET /documents/:id` renamed the item's
  `line_total` to `total_price` on the wire and dropped `unit`, while the
  frontend `InvoiceItemDto` reads `line_total`/`unit` — the values were
  stored correctly the whole time; quantity/unit_price/invoice total
  rendered only because their keys happened to match. Item keys now mirror
  the entity columns; a repository-mocked contract test pins the exact
  per-item key set. **Acceptance CONFIRMED on the deployed demo
  (2026-11-28, user-verified)**: a fresh sample renders `€960.00`,
  `€1,260.00`, `€440.00` with `Std.` units. Two follow-up UI nits from the
  same session, also fixed on `main` (`88fab5a`, frontend-only, tsc +
  eslint + `next build` green): the header status badge could sit
  off-center while processing (title falls back to the long demo filename
  until extraction completes; `leading-none` on the h1 keeps the badge on
  the glyphs' visual center in every state) and the Line Items grand total
  dropped its serif `text-lg` styling to match the table's numeric cells.
  New backend test baseline: **27 suites / 234 tests** on a clean throwaway DB
  (the older 215/24 figure is stale). The finding has NO audit ID — never
  label it DD-5 (that ID belongs to the smoke finding).
- **DD-5 FIXED (2026-11-28, `032e6a5`)** — every JSON parse in
  `scripts/smoke-demo.mjs` goes through `readJson()`, which fails labeled
  (step, status, body snippet) on non-JSON 2xx bodies; `node --check`
  green, happy-path parsing unchanged.
- **Keep-alive DECIDED: stay as is.** Render dashboard (Billing → Monthly
  Included Usage): 750 free instance-hours/month shared by THREE active
  services (doclos-frontend, doclos-backend, konfequem-backend); burn
  ≈ 23.3 h/day = both doclos services at ~50% duty-cycle from the 30-min
  GH pings; 630.13/750 on Nov 28 → month ends ≈ 698, fits. 750 h ≈ exactly
  ONE service awake 24/7, so an external 5-min pinger (backend-only
  ~720 h) leaves zero budget for any frontend monitoring — rejected. The
  GH 30-min cadence already keeps `/readyz` hitting Postgres twice an hour
  (Supabase auto-pause stays solved). The real cold-start fix is upgrading
  the backend to Starter (~$7/mo) — revisit only if cold starts bother
  visitors.
- **All compromised secrets are rotated (2026-11-28) — see
  `docs/SECRETS_ROTATION.md` rotation log.** JWT, GLM (international Z.ai,
  Standard API key), R2 keys and the Supabase DB password are dead-and-
  replaced; every leaked value from the pre-2026-09-22 history is now
  unusable. Verified live: auth, full synthetic pipeline (`parsed`), R2
  read (presigned + streamed) and write (fresh-account upload), `/readyz`
  all-ok. Upstash Redis deliberately skipped (never leaked).
- Public demo hardening merged into `main`; PRs #1–#14 all merged.
  The MF wave (2026-11-28, `docs/MVP_FOLLOWUP_AUDIT.md`) is closed:
  MF-1 — the duplicate-registration race returns the uniform PD-A4 body
  instead of 500 (4b68990); MF-2 — the scheduled uptime smoke
  (`.github/workflows/uptime.yml`) is live on `main`, first
  `workflow_dispatch` run green in 45 s (46086432840). The same day the
  deployed backend went down because the Supabase free-tier project
  auto-paused after ~a week idle (`tenant/user not found` at the pooler);
  it was restored from the Supabase dashboard and the backend
  self-recovered — `/healthz` and `/readyz` green.
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
  - #11 (`fix/retention-null-last-login`, merge b3472e1): PD-D4 — the
    retention sweep also selects never-logged-in accounts (`last_login`
    NULL ages from `created_at`); deployed, production result below.
- `main` = `88fab5a` (2026-11-28: extraction display fix + DD-5 merged
  --no-ff from `work/detail-items-dd5`, docs closure, then the two UI
  fixes — all direct-to-main without PRs per the lead's session decision:
  CI triggers on the main push, so small verified fixes skip the PR page;
  PRs remain for multi-finding waves). Both deploys verified live
  post-push: `/readyz` all-ok, frontend 200 with redirect chain.
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
  - PD-D4 deployed (PR #11, merge b3472e1; production check 2026-11-10):
    `DEMO_RETENTION_DAYS=14`. The first sweep after the backend start
    purged 10 inactive accounts and successfully deleted 2 linked R2
    files; the observed log fragment contained no errors. Only this
    post-startup run is confirmed — see "Not verified".
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

- **Only the first, post-startup retention sweep run is verified**
  (2026-11-10, purged 10 inactive accounts — see the deployed section
  above). The recurring 24-hour interval and later cold-boot runs have
  NOT been observed — do not claim the periodic sweep runs or succeeds
  until one such run is recorded.
- The earlier "full deployed smoke passed" note predates the smoke-script
  fix: its delete/reset assertions were unreliable, and before 2026-11-06 the
  smoke had never called `DELETE /account` — consistent with DD-3 surfacing
  in the production logs only after that earlier run. The 2026-11-06 run
  above is the first one with correct assertions and account-deletion
  coverage.

## Open findings (reported, not fixed — audit-first)

- ~~DD-5 (Low, `scripts/smoke-demo.mjs`)~~ — FIXED 2026-11-28 (`032e6a5`,
  merged in `e95da1e`); see `docs/DEMO_DELETE_AUDIT.md`. The DD wave has no
  open findings left.

## Next session

- [ ] **Extraction display acceptance (fix merged, deploy check pending):**
      the key-mismatch fix (`bf62bd1`) is on `main` (`e95da1e`); after the
      Render deploy, load a fresh synthetic sample and confirm the line
      item renders `960,00` and the unit `Std.`.
- [x] **Keep-alive (decided 2026-11-28): stay as is** — see the Current
      state block for the instance-hours math (750 h ≈ one always-awake
      service; external pinger rejected; the Starter upgrade remains the
      real cold-start fix).
- [ ] TODO-1 (deferred, not planned): no "forgot password" path on the
      login form — needs an email-sending infrastructure decision first.
- [ ] Retention sweep: the first post-startup run is confirmed (2026-11-10,
      purged 10 inactive accounts) — capture a recurring-interval or
      later cold-boot run to verify the periodic path too. With the uptime
      pings keeping the backend awake this should now fire on the 24-hour
      interval; check the logs after a day of uptime.
- [x] DD-5 fixed (2026-11-28, `032e6a5`) — labeled `readJson()` helper in
      the smoke script.
- [ ] Decide whether to add a custom domain.
- [ ] Confirm the 14-day demo retention setting remains intentional.
- [ ] Schedule periodic rotation of Z.ai, R2, JWT and Redis credentials —
      next planned rotation ≈ late February 2027 (90 days after the
      2026-11-28 rotation).
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
- The Supabase free-tier project auto-pauses after ~a week of inactivity —
  the pooler then answers `tenant/user not found` and the backend
  crash-loops at boot (happened 2026-11-10 → 2026-11-28). The uptime
  workflow's pings now double as keep-alive activity, but after any future
  pause the recovery is a Supabase dashboard restore.
- Resetting a synthetic sample does not reset the `1 sample/day/user` quota.
- The smoke test consumes demo quota and creates temporary test
  accounts/documents; it also deletes one account (user A) mid-journey.
