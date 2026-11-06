# Doclos — Documentation Map

One entry point for finding the right document. Keep this map current when
documents are added, closed, or archived.

## Current status

- [`NEXT_SESSION_TODO.md`](./NEXT_SESSION_TODO.md) — the living session
  status: what is verified, what is explicitly not verified, open findings,
  next steps, guardrails.
- [`../README.md`](../README.md) — public-facing project overview and the
  MVP demo notice.

## Runbooks

- [`../QUICK_START.md`](../QUICK_START.md) — local development, the verified
  local demo path, demo privacy/retention/imprint placeholders.
- [`../CLOUD_SETUP.md`](../CLOUD_SETUP.md) — cloud services setup
  (Supabase, Upstash Redis, Cloudflare R2, Z.ai/GLM).
- [`DEPLOYMENT_RENDER.md`](./DEPLOYMENT_RENDER.md) — Render deployment
  (backend + frontend services, environment contract).
- [`POST_DEPLOY_SMOKE.md`](./POST_DEPLOY_SMOKE.md) — post-deploy smoke test
  runbook (`scripts/smoke-demo.mjs`).
- [`SECRETS_ROTATION.md`](./SECRETS_ROTATION.md) — secret rotation runbook.

## Audits

Open / current (keep in `docs/` until closed):

- [`DEMO_DELETE_AUDIT.md`](./DEMO_DELETE_AUDIT.md) — DD-1…DD-6, delete-path
  findings; DD-5 (Low, smoke script) still open.

Closed (kept for reference in `docs/archive/` — do not append; start a fresh
checklist document for any new audit round):

- [`archive/AUDIT.md`](./archive/AUDIT.md) — 2026-09 code & UX audit cycle
  (closed 2026-10-11).
- [`archive/PUBLIC_DEMO_AUDIT.md`](./archive/PUBLIC_DEMO_AUDIT.md) —
  2026-10 public-demo hardening audit & plan (wave merged 2026-10-15).

Related measurement ledger:

- [`../QUALITY.md`](../QUALITY.md) — wave-5 extraction-quality baseline and
  results (S4, 2026-09-24), with re-measurement instructions.

## Historical design docs

- [`../documentations/`](../documentations/) — the original pre-build design
  specification (parts 1 and 3–9; the old "part 2 copy" file was removed as a
  duplicate in `7e25e86`). These describe the *planned* system, not the
  current one — where docs and code disagree, the code wins. Divergences are
  listed in [`../documentations/DISCLAIMER.md`](../documentations/DISCLAIMER.md).

## Conventions

- Audit-first: new findings get a fresh checklist document; when an audit
  cycle closes, its document moves to `docs/archive/` with a closure banner.
- No secret values in any tracked document — credentials live only in the
  untracked `.env` and platform dashboards.
