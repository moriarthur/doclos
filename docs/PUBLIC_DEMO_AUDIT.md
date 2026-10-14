# Public Demo Preview — Technical Audit & Hardening Plan

> Branch: `feat/public-demo-hardening` · Audit date: 2026-10-15
> Goal: any visitor from GitHub can register an isolated account and safely
> process a synthetic document. **No shared demo login** — this replaces the
> previous `DEMO_EMAIL`/`DEMO_PASSWORD` shared-account model merged in 3649f7c.
> Scope driver: `codex_audit` (root, untracked).

## 0. Baseline state (verified against code, 2026-10-15)

Solid foundations already merged on main:

- Magic-byte upload validation + shared `upload-constraints.ts` (P0-4), UUID-based S3 keys (no raw filename).
- Tenant scoping: documents list/get/file/validate/reprocess/delete, search, export (list + detail), jobs — all filter `user_id`; customer dedup scoped by `user_id` (P0-2); worker re-checks ownership (`document.processor.ts:106-111`).
- `@nestjs/throttler` global 120/min + per-route overrides (auth 10/min, upload 10/min, reprocess 10/min), **in-memory** store.
- JWT access/refresh type claims enforced in both directions (P0-3); refresh endpoint rejects access tokens; API rejects refresh tokens.
- Email normalization on register/login (P0-3); login errors are generic.
- `synchronize: false`, migrations-only, migration matrix verified on clean DB (2026-10-12); TLS verification ON for Supabase pooler via `DB_CA_CERT_PATH` (H-8).
- Graceful shutdown hooks (P2-6); `/healthz` liveness probe outside `/api/v1`.
- CI: frozen install, backend/frontend typecheck, lint, backend tests, production builds.
- Recovery sweep for documents stuck in `processing`.
- CORS locked to `FRONTEND_URL` in production; helmet enabled; same-origin Next.js rewrite proxy via `BACKEND_ORIGIN`.

## 1. Findings

Severity: **C** = blocks public launch, **H** = must fix pre-launch, **M** = fix in this wave, **L** = opportunistic.

### Secret hygiene

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| S-1 | M | No secret-rotation runbook; git history contains pre-hardening credentials (known since the repo went public). | `docs/SECRETS_ROTATION.md` (new) |
| S-2 | M | Production env validation doesn't enforce JWT secret strength, rejects no placeholder values, and doesn't require `FRONTEND_URL` in production. | `apps/backend/src/app.module.ts` |
| S-3 | L | Dead env vars in `.env.example` / deployment contract: `MAX_FILE_SIZE`, `ALLOWED_FILE_TYPES` (code uses `upload-constraints.ts`), `DEMO_EMAIL`/`DEMO_PASSWORD` (shared demo removed by this wave). | `.env.example`, `CLOUD_SETUP.md` |

Tracked-tree scan (2026-10-15): every secret-shaped value in tracked files is a placeholder; `.env` is untracked. The shared demo password `change-me-demo-1234` appears in `README.md:97`, `QUICK_START.md`, `CLOUD_SETUP.md:154` — resolved with D-1/D-2 (shared demo removed entirely).

### Abuse & cost protection

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| R-1 | H | Throttler store is in-memory: limits reset on restart and don't share state across instances; prompt allows this only as an extra layer with documentation. Redis is already a hard dependency (Bull). | new `common/rate-limit/`, `app.module.ts` |
| R-2 | H | **No per-user quotas at all**: docs/hour, docs/day, active-processing cap, storage cap, reprocess/day/document, sample/day. A registered user can currently burn GLM/R2 unbounded (IP rotation defeats IP limits). | new `common/quota/`, `documents.service.ts` |
| R-3 | M | IP limits don't match the public-demo spec: upload 10/min (spec 5), reprocess 10/min (spec 5), no registration 3/h, no sample 2/h. | `documents.controller.ts`, `auth.controller.ts`, new demo controller |
| R-4 | M | No `trust proxy` handling: behind Render's proxy every client shares the proxy IP (breaks per-IP limits) unless X-Forwarded-For is handled safely; a client can also spoof XFF for a direct hit. | `main.ts` |
| R-5 | M | 429 responses carry no retry information. | `common/rate-limit/` |
| R-6 | H | Bull is configured from `REDIS_HOST`/`REDIS_PORT` only — a `REDIS_URL` (what Render Key Value / Upstash provide) is parsed just for a password. Deploying to Render KV would silently ignore the URL. | `app.module.ts` |

### Upload / OCR hardening

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| U-1 | H | No PDF page limit: a 500-page PDF renders every page at scale 3 (memory/time blowup) before OCR; only a `>20 pages` warning is logged. | `ocr.service.ts`, `pdf.service.ts`, new env `MAX_PDF_PAGES` |
| U-2 | H | No timeouts on PDF parse (`pdf-parse` can spin on malformed files), PDF render (`pdf-to-img`), or OCR (Tesseract). GLM calls already have timeouts. | `pdf.service.ts`, `ocr.service.ts` |
| U-3 | M | `S3_SIGNED_URL_EXPIRATION` exists in `.env.example` but is never read; signed URLs hardcode 24 h — too long for a public demo. | `s3.service.ts`, `documents.service.ts:257` |
| U-4 | M | Oversized images (e.g. 30000×30000 JPEG) pass the byte cap but explode during sharp preprocessing / Tesseract. No pixel-dimension cap. | `image-preprocessing.service.ts`, new constraint |
| U-5 | L | Malformed-PDF handling: `getMetadata` swallows errors and pretends `pageCount: 1`; parse errors on `extractText` propagate but without a user-facing error state distinction. Fold into U-1/U-2 error states (`ERROR` status + readable message). | `pdf.service.ts`, `document.processor.ts` |

### Authentication & session security

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| A-1 | H | Access/refresh tokens stored in `localStorage` **and** JS-readable cookies → any XSS exfiltrates a 30-day refresh token. | `apps/frontend/src/lib/api-client.ts:328-346`, new cookie-issuing backend |
| A-2 | H | No refresh-token rotation, no server-side session store, no revocation: a stolen refresh token works until 30-day expiry; logout is client-side only (tokens stay valid). | `auth.service.ts`, new `refresh_sessions` table |
| A-3 | H | No CSRF protection for the upcoming cookie-based transport (double-submit token needed once the backend reads HttpOnly cookies). | new `common/csrf/` |
| A-4 | M | Registration answers `User already exists` → email enumeration. Register should not reveal existence. | `auth.service.ts:29-31` |
| A-5 | M | No separate registration limit (3/h/IP per spec) and no refresh-endpoint-specific throttling. | `auth.controller.ts` |

### Tenant isolation

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| T-1 | H | **No account deletion** (`DELETE /api/v1/account`) — required for a public demo (GDPR-facing expectation even for a demo). | new `account` module |
| T-2 | M | No IDOR integration tests (scoping verified by reading code; tests must pin it). | new specs |

Verified non-issues (no action): export list/detail scoped by `user_id`; jobs endpoints scoped; search scoped; storage keys UUID-based; worker ownership re-check present.

### Demo sample flow

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| D-1 | C | **Shared demo account** (`DEMO_EMAIL`/`DEMO_PASSWORD` seed) contradicts the new product decision: every visitor must get an isolated account. | `src/database/seeds/demo.seed.ts`, new `demo` module + endpoint |
| D-2 | H | Shared demo password published in README/QUICK_START/CLOUD_SETUP. | `README.md:97`, `QUICK_START.md`, `CLOUD_SETUP.md` |
| D-3 | M | No "Load synthetic sample" in-product flow: sample PDF is a seed-side file, not a per-user pipeline document; no per-user reset; no retention cleanup for inactive demo accounts. | new `demo` module, new frontend states, new sweeper |

The synthetic invoice content itself is clean (fictional companies, Musterstraße, Bundesbank sample IBAN, no PII) and will be reused by the per-user endpoint.

### Health & observability

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| H-1 | M | No `/readyz` (Postgres/Redis/storage/queue checks) — Render needs a readiness probe distinct from liveness. | `health` module |
| H-2 | M | No request correlation ID for tracing demo incidents. | new middleware |
| H-3 | L | Log hygiene spot-check: pipeline logs durations/confidences only; AI service logs provider errors — must redact anything request-shaped when surfacing provider errors. | spot-fix |

### Database & TLS

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| M-1 | M | `enable-rls.cjs` connects with `rejectUnauthorized: false` (line 58) instead of the app's pinned-CA logic. | `apps/backend/scripts/enable-rls.cjs` |
| M-2 | M | New migrations required: `refresh_sessions` (A-2), account-deletion support, demo retention fields (last-seen/activity marker if needed). | `src/database/migrations/` |

### Deployment (Render)

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| DEP-1 | H | Backend binds `APP_PORT` (default 3001) only; Render injects `PORT`. Must bind `PORT || APP_PORT` on 0.0.0.0. | `main.ts` |
| DEP-2 | M | No Render deployment docs / post-deploy smoke runbook / rotation doc. | `docs/DEPLOYMENT_RENDER.md`, `docs/POST_DEPLOY_SMOKE.md` |
| DEP-3 | M | Frontend can't be a static export: `middleware.ts` (auth redirects) + same-origin `/api/v1` rewrite proxy (required once auth is cookie-based) need the Next server → Render Web Service for the frontend, not Vercel/Cloudflare Pages (both would work, but Render keeps the stack on one platform and the rewrite proxy needs `BACKEND_ORIGIN` env support at build/run time, which Render provides). | `docs/DEPLOYMENT_RENDER.md` |
| DEP-4 | M | No automated smoke script exercising the full user journey without printing secrets. | new `scripts/smoke-demo.mjs` |

### CI & tests

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| CI-1 | M | CI lacks: secret scanning, migration validation on clean Postgres, and the smoke script. | `.github/workflows/ci.yml` |
| CI-2 | H | No tests for: session security (rotation/reuse/revocation), CSRF, IDOR, quotas, upload validation, page limit, signed-URL TTL, readiness, account deletion, sample isolation, PORT binding. | new `*.spec.ts` |

### Product safety / documentation

| ID | Sev | Finding | Files |
|----|-----|---------|-------|
| DOC-1 | M | No MVP-demo disclaimer, privacy notice, retention policy, imprint/contact placeholder, or account-deletion instructions in public surfaces. | `README.md`, frontend UI |
| DOC-2 | M | Verify no public surface claims full DSGVO compliance (must say "DSGVO-ready demo"); visible "Synthetic sample" label. | `README.md`, frontend |

## 2. Planned fixes → commit mapping

One finding(-group) per commit, each keeping `tsc --noEmit` green (backend + frontend), jest green, lint green:

1. `docs(audit)` — this document.
2. `feat(secrets)` — S-1, S-2: SECRETS_ROTATION.md; production env validation (JWT_SECRET ≥ 32 chars, placeholder values forbidden — incl. `your-super-secret-jwt-key-change-in-production` and `change-me-demo-1234`; `FRONTEND_URL` required in production).
3. `fix(infra)` — R-6, DEP-1: REDIS_URL-first Bull config (Render Key Value / Upstash compatible, host/port fallback), `PORT` binding.
4. `feat(rate-limit)` — R-1, R-3, R-4, R-5: Redis-backed throttler store + trust-proxy-aware client IP + spec IP limits + 429 retry info (+ docs when in-memory fallback is used).
5. `feat(quota)` — R-2: per-user quotas in Redis (docs 3/h & 10/day, storage 100 MB, 1 active job, reprocess 2/day/doc, sample 1/day) + friendly 429s + tests.
6. `feat(upload-hardening)` — U-1…U-5: MAX_PDF_PAGES (default 10, validated), parse/render/OCR timeouts, pixel-dimension cap, signed-URL TTL from ConfigService (default 15 min), pipeline error states + tests.
7. `feat(auth-sessions)` — A-2 (+M-2 migration): `refresh_sessions` table (hash-only), rotation with reuse detection, revoke-on-logout endpoint, type-claim tests.
8. `feat(auth-cookies)` — A-1, A-3: backend issues HttpOnly+Secure+SameSite cookies, reads them for auth, drops token-in-body; double-submit CSRF guard + tests.
9. `feat(auth-api)` — A-4, A-5: opaque register response, registration throttling + tests.
10. `feat(frontend-auth)` — frontend migration off localStorage (cookie + CSRF header, loading/error/success states).
11. `feat(account-deletion)` — T-1: `DELETE /api/v1/account` (transactional rows + R2 objects + session revocation; observable/retryable cleanup) + tests.
12. `feat(demo-sample)` — D-1, D-3, R-2(sample): `POST /api/v1/demo/sample`, `DELETE /api/v1/demo/sample` (own-documents reset), quota 1/day, frontend button + states, retention sweeper (env-configurable), retire shared seed from deployment contract + tests.
13. `feat(observability)` — H-1, H-2, H-3: `/readyz` (no secrets), correlation-ID middleware, provider-error redaction + tests.
14. `fix(tls-script)` — M-1: enable-rls.cjs uses the pinned-CA logic, never prints credentials.
15. `chore(ci)` — CI-1, CI-2 remainder, DEP-4: smoke script, secret scanning, migration check job.
16. `docs(public)` — D-2, DOC-1, DOC-2, DEP-2, DEP-3: README/QUICK_START/CLOUD_SETUP rewrite, DEPLOYMENT_RENDER.md, POST_DEPLOY_SMOKE.md, in-product notices.
17. Final gates + report.

## 3. Acceptance criteria (launch gate)

- Registration gives a fresh isolated tenant; sample endpoint queues the real pipeline under the caller's `user_id`; no shared credentials exist anywhere public.
- IP limits: auth 10/min, upload 5/min, reprocess 5/min, sample 2/h, register 3/h, API 120/min — enforced via Redis, correct behind a reverse proxy; user quotas enforced independently per user; 429s carry retry info.
- PDFs > MAX_PDF_PAGES and pipelines exceeding stage timeouts fail into a visible error state without calling GLM.
- Bearer-token auth replaced by HttpOnly cookies (+ CSRF double-submit); refresh rotation with reuse detection; logout/revocation server-side; access↔refresh cross-use rejected; account deletion works end-to-end.
- `/readyz` reflects Postgres/Redis/storage/queue readiness without leaking values; every request carries a correlation ID.
- Migrations apply cleanly to a fresh database; enable-rls.cjs verifies TLS like the app.
- CI green including secret scan; smoke script passes against a local production-style run without printing secrets.
- Docs state MVP-demo status, retention, privacy notice, deletion path; no DSGVO-compliance claims beyond "DSGVO-ready demo".
- None of: secrets printed/committed, production DB touched, `synchronize: true` introduced, external cloud resources created.

## 4. Explicitly out of scope (this wave)

- Creating any Render/Upstash/R2 resources (docs + dashboard steps only).
- Real email verification / password reset (no mail provider).
- OAuth login, 2FA.
- Full DSGVO compliance program (demo is "DSGVO-ready", not certified).
