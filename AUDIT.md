# Doclos — Code & UX Audit (2026-09-21)

Full-project audit: backend, frontend, infra. Read-only review; nothing here was changed in the repo.

## Status — living checklist (updated 2026-09-24 by main agent)

**Wave `feat/s4-quality` — S4 parsing quality (2026-09-24, branch off `16e519a`):**
T-1 quality harness ✅ (`e985488`) — T-2 ground truth 30 docs ✅ (`59603ee`) —
T-3 baseline ✅ — T-4 deterministic source-verification guard ✅ (`c25d673`,
enum-key fix `7b58346`) — T-5 evidence-based assessor prompt ✅ (`65dd4d4`,
rev 2 `18ac841` after the rev-1 null/currency over-penalization, see
QUALITY.md) — T-6 re-measured ✅: **auto-parse precision 94% → 98% (text arm),
false-parsed scan docs eliminated (0/15)**; recall cost 28 → 11/30 text docs
auto-accepted — assessor calibration is the documented next-wave lever.
All numbers and scope limits in QUALITY.md. Tests 105/105, tsc green, backend
boots. Awaiting user push confirmation (overnight rule: no merge/push).

**Wave `fix/loose-ends-u5-u7-ab` — loose ends + thinking A/B (2026-09-24, branch off `99373e9`):**
U-7 ✅ auto-login after register (`0157fe6`) — U-5 ✅ real upload progress via
axios `onUploadProgress`, simulated bar removed (`e8105e9`) — H-3 caveat ✅
resolved by A/B: KEEP `GLM_THINKING_EXTRACT=disabled`, .env unchanged (see H-3;
no code change, docs-only).

**Wave `fix/hardening-glm-tls` — latency + TLS hardening (2026-09-22, branch off main `33fe4ef`):**
H-1 ✅ H-2 ✅ H-3 ✅ (rev 2 — glm-4-flash removed from bigmodel.cn, see finding)
H-4 ✅ H-5 ✅ H-6 ✅ H-7 ✅ H-8 ✅ I-1 ✅. Live-verified: pipeline total 17.7s (was ~3 min),
classify 1ms keyword-only, confidence 90% → auto-accept; TLS strict via pinned CA.
**Auditor verdict 2026-09-23: PASS, merge approved, no blockers.** Independently
verified by the auditor: 87/87 jest, tsc green both apps, `git diff --check` clean,
H-8 CA fingerprint re-checked live against the pooler chain (exact match).
For this wave the user substituted codex with a GLM auditor session (doclos-6d);
same standing process otherwise. Finding I-1 fixed pre-merge (`b0793e0`).
Merged --no-ff to main and pushed (2026-09-23).

**Wave `fix/audit-security` — ALL DONE, merged to main `1c44c94` after auditor review:**
P0-1 ✅ P0-2 ✅ (+FK migration `fb7315c` on polish branch) P0-3 ✅ (live-tested) P0-4 ✅
P1-1 ✅ P1-2 ✅ P1-3 ✅ P1-4 ✅ (landed inside P0-4 commit, marker `7d0ad33`) P1-5 ✅
P1-6 ✅ P1-7 ✅ P1-8 ✅
Review blockers closed pre-merge: webp in frontend ACCEPTED_TYPES (`4c0b503`),
P1-1/P1-2 regression tests (`fa34010`).

**Branch `fix/audit-polish` — auditor APPROVE; MERGED into local main (`d15614a`).**
Then reconciled with the July origin/main wave (S4/S5/hardening, 43 commits — local
clone had been stale): merge commit `c588c08` + porting fixes `c623deb` + diagnostics
migration. Pending: auditor re-audit of the July attack surface (per-type export
ownership, metadata sanitization, formula escaping, ?lang=) → then push (user OK'd).
- U-1 ✅ `f06e95b` (hand-rolled ToastProvider) — U-2 ✅ `dcbce3c` — U-3 ✅ `117a6fb`
  (backend `exclude_status` + client filter removed) — U-6 ✅ `60e74aa` (debounced
  server search over status=archived)
- P2-1 ✅ `5467326` (+`cdef380` explicit varchar after union-type metadata crash)
- P2-2 ✅ `e7fe063` (transition map, POST /:id/unarchive, PATCH DTO)
- P2-3 ✅ `10f48f6` (reprocess 409, cancelByDocument no-op, attempts oddity removed)
- P2-4 ✅ `3495502` (extraction persistence in one transaction)
- P2-5 ✅ `5687616` — P2-6 ✅ `57b3727` (Joi env schema, shutdown hooks, new URL)
- P2-7 ✅ `4a97974` (helmet) — P2-8 ✅ `5463319` — P2-9 ✅ `153a542`
- P2-10 ✅ `270ef2f` — P2-11 ✅ `029f288` — P2-12 ✅ `14ad5af`
- P2-13 ◐ partial: 3 spec files / 18 tests (German dates+amounts, jobs ownership,
  customer scoping). More coverage optional.
- FK migration customers.user_id ✅ `fb7315c` (column -> uuid + constraint)
- Not done (out of waves, still open): **U-4** (done later — editable line items /
  unit column, merged `33fe4ef`), **U-5** + **U-7** (done in wave
  `fix/loose-ends-u5-u7-ab`, see top block).

Verification state: tsc green (both apps), 18/18 jest green, backend boots with env
validation + helmet, both migrations applied to dev DB. NOT pushed to origin.

---

**Execution order for the worker:** fix P0 → P1 → P2 → UX. Do NOT start roadmap features (S2 dark mode etc.) until P0 and P1 are done.

**Working rules:**
- Branch: `fix/audit-security` (P0+P1), then `fix/audit-polish` (P2+UX).
- One finding = one commit, reference the finding ID (`P0-1`, `P1-3`, …) in the commit message.
- After each finding: `cd apps/backend && npx tsc --noEmit` and same for `apps/frontend` must pass. Backend must still boot (`pnpm start:dev`) before committing.
- Do not rename public API response fields unless the finding says so — the frontend depends on them.
- **Auditor (2026-09-22, standing):** the user runs **codex** as an independent auditor. Before any merge, codex reviews the branch diff; blockers are closed pre-merge (auditor PASS required, same as waves 1–2). New findings discovered during any work are appended here with the next free ID (`H-x`, then `I-x`, …) instead of being fixed drive-by.

---

## Wave 3 — Hardening / latency (2026-09-22, branch `fix/hardening-glm-tls`)

Trigger: "обработка длится очень долго" + codex brief (`AUDIT` file in repo root).
Live baseline measured 2026-09-22 14:22–14:25: classification + extraction ~3 min for a
text-PDF, with glm-4.7-flash 429s burning retry budget and reasoning tokens.

### H-1. 429 burns the retry budget on the overloaded model (slow failover)
`ai.service.ts` `callOnce` returned only `retryable: boolean` — a 429 ("model busy")
got the same same-model retry as a 5xx. Z.ai "busy" doesn't clear in seconds; both
attempts were wasted before the failover (observed live: two 429s back-to-back).
**Fix:** `callOnce` returns `reason: 'rate-limit' | 'server' | 'timeout'`; 429 →
immediate failover, 5xx/timeout → one same-model retry with jittered backoff.
**Accept:** unit tests (429 → 1 call per model; 5xx → retry-then-failover; 4xx throws).
✅ `48f2bf1`

### H-2. One 120s timeout for every call: classification waits like extraction
Classification is a tiny JSON call; extraction legitimately runs long.
**Fix:** `sendMessage/sendJsonMessage` accept `opts.timeoutMs`; env
`GLM_TIMEOUT_CLASSIFY_MS` (30s) / `GLM_TIMEOUT_EXTRACT_MS` (120s).
✅ `9791247`

### H-3. Wrong model class + forced reasoning (rev 2)
Original brief: switch to glm-4-flash. **Live probe: glm-4-flash was REMOVED from
open.bigmodel.cn (error 1211)** — the hard 400 surfaced it instantly (no retries, per
H-1). glm-4.5/4.7 are hybrid-reasoning and burn chain-of-thought even on trivial JSON
(measured: `thinking:{"type":"disabled"}` answers in ~1s vs minutes with thinking).
**Fix:** primary `glm-4.5-flash` + `thinking.type=disabled` (env
`GLM_THINKING_CLASSIFY`, default disabled; `GLM_THINKING_EXTRACT`, default auto/omit);
`glm-4.7-flash` demoted to failover. `GLM_MAX_TOKENS` (8192, was hard 16384 sized for
reasoning output). Extraction quality gate: reprocessed invoice → confidence 90%
auto-accept, fields confidence 1.00 (was 73% needs_validation with thinking).
✅ `cab3464` + rev 2 `1d5a814`
Caveat (2026-09-23, auditor request): `GLM_THINKING_EXTRACT=disabled` in .env is
an EXPERIMENT — confidence 90% verified on clean text PDFs only, not yet on
scanned/messy documents. Revert is env-only (unset the var → model default auto).
**A/B resolved 2026-09-24 (wave 4): KEEP `disabled`.** Same 20 docs reprocessed
disabled vs auto (12 scan-like JPGs — rasterized 150dpi + noise, OCR path; 8 text
PDFs from `1000+ PDF_Invoice_Folder`):
- Confidence: scan arm overall 0.69 → 0.64, text arm 0.86 → 0.82; text parsed
  7 → 4 (confidence-assessment downgrade with NO extracted-value changes).
- Field regressions under auto on scans: invoice_number hallucinations/noise —
  01.jpg `AB10015140` → `Var 08 2012` (source PDF `Order ID: CA-2012-AB10015140-40974`
  confirms disabled correct); 05/08/12.jpg noise appended; 11.jpg errored twice.
- Speed: extract median 9.7s (disabled) vs 107s (auto, max 302s) — ~11×.
- Stability: 20-doc burst under auto → 66×429 + 6 empty-JSON (thinking burns the
  8192 budget → empty content) → 10 docs `error`; disabled run: 0 errors.
Verdict: disabled wins on quality, speed, and stability. Harness note: the 429
storm is a burst artifact — sequential reprocessing is clean; batch reprocess
could rate-limit itself someday (observation only, no finding ID).

### H-4. LLM classification call per document is unnecessary
Keyword rules already existed as the fallback (`ruleBasedClassification`).
**Fix:** invert the order — rules answer first (LLM call skipped), LLM only
adjudicates UNKNOWN keyword results; rule-based result remains the final fallback.
ClassificationResult format unchanged. **Accept:** classifier unit tests; live log
"classified as invoice by keywords (LLM call skipped)". ✅ `e92611b`

### H-5. Fixed 3s "rate limit buffer" before every extraction (codex brief #3)
`document.processor.ts` slept 3s before each extraction call — taxed 100% of
documents to guard 0%. **Fix:** removed; rate limiting is AiService's job (H-1).
✅ `9063719`

### H-6. Tesseract worker booted and terminated per page
`createWorker` (wasm + deu+eng traineddata) per recognize dominates scanned-PDF OCR.
**Fix:** one long-lived worker (lazy boot, promise-chain mutex — workers are not
concurrency-safe), `onModuleDestroy` termination, recycle after a wedged recognize.
✅ `acb1f97`

### H-7. No per-stage timing diagnostics (codex brief #6)
**Fix:** one summary line per document: download / ocr / classify / extract+persist /
total (durations only, no content). Live: `download: 397ms, ocr: 100ms, classify: 1ms,
extract+persist: 16688ms, total: 17691ms`. ✅ `c825429`

### H-8. DB TLS verification disabled (`DB_SSL_REJECT_UNAUTHORIZED=false`)
Pooler chain is issued by the private "Supabase Root 2021 CA" (verified via
`openssl s_client`), which Node's store doesn't trust. **Fix:** CA pinned and
committed (`apps/backend/certs/supabase-prod-ca-2021.crt`, sha256-checked against the
live connection, valid until 2031) via `DB_CA_CERT_PATH` → `ssl.ca` +
`rejectUnauthorized: true`; the false-flag remains as documented proxy escape hatch.
Verified live: pg connects to the pooler with strict verification.
(Note: implemented as TypeORM `ssl.ca`, not NODE_EXTRA_CA_CERTS — the env var must be
set before node boots, so dotenv-loaded values don't apply; `ssl.ca` covers both the
app and the TypeORM CLI via the shared dataSourceOptions.) ✅ `f42dab2`

### I-1. No backoff on 429 when only one model is configured (audit 2026-09-23)
Auditor finding (GLM auditor session, non-blocking): in `fetchWithRetry` the
rate-limit branch `continue`d straight to attempt 2 when `models.length === 1`,
skipping the backoff block — two instant 429 calls, then throw. Unreachable with
the current .env (fallback configured). **Fix:** single-model 429 retries apply
the same jittered backoff as the 5xx path; guard test asserts the >= 4.2s gap.
✅ `b0793e0`

### Codex brief reconciliation
- #1 (model) → H-3 rev 2 (glm-4-flash doesn't exist — replaced with glm-4.5-flash +
  thinking off). #2 (rule-based classify) → H-4. #3 (delays) → H-5. #4 (one extraction
  request) → verified: one main extraction call + separate confidence-assessment call
  (kept — it is the confidence/diagnostics safeguard the brief says not to remove).
  #5 (worker) → H-6. #6 (timings) → H-7. #7 (.env.example) → H-2/H-3.
  #8 don'ts respected; #9 tests: 70 AI/OCR unit tests + suites green.

## P0 — Security (fix first)

### P0-1. IDOR: Jobs API has zero ownership checks
Any authenticated user can read/cancel ANY other user's jobs and flip ANY document to `error`.
- `apps/backend/src/modules/jobs/jobs.controller.ts:11-28` — all 4 routes pass only ids, never the user.
- `apps/backend/src/modules/jobs/jobs.service.ts` — `getJobStatus` (:21), `getDocumentJobs` (:54), `cancelJob` (:92), `cancelByDocument` (:116) query by id only.
- Worst case: `DELETE /jobs?document_id=<victim-doc>` sets a stranger's validated document to `ERROR`.

**Fix:** inject `@CurrentUser()` into all 4 endpoints; in the service, before acting, verify `documentsRepository.findOne({ where: { id: documentId, user_id: userId } })` (404 otherwise). For `cancelJob`, load the job, then check ownership via `job.document_id` → document. Replace `throw new Error(...)` at jobs.service.ts:99 with `BadRequestException` (currently → 500).

**Accept:** `curl -H "Authorization: Bearer <userB-token>" /jobs/<userA-job-id>` → 404; same for cancel.

### P0-2. `customers` table is global — cross-tenant data mixing
`customer` has no `user_id`. The processor dedups suppliers by name across ALL users:
- `apps/backend/src/modules/documents/entities/customer.entity.ts` — no `user_id` column.
- `apps/backend/src/modules/documents/processors/document.processor.ts:309-323` — `findOne({ where: { name } })` matches other tenants' rows and reuses them (address etc. leak between accounts); new customers are created ownerless.

**Fix:**
1. Add `@Column({ name: 'user_id' }) user_id: string;` + `@ManyToOne(() => User)` to `Customer`, plus `@Index(['user_id', 'name'])`.
2. Processor: `findOne({ where: { user_id: userId, name } })`, create with `user_id: userId` (pass `userId` into `extractInvoiceData` — it already has `job.data.userId`).
3. Backfill existing rows: one-off script `apps/backend/scripts/backfill-customer-user-id.cjs` (follow existing `_db-check.cjs` pattern) — set `user_id` from the owning document (`documents.customer_id → documents.user_id`); rows that can't be attributed: log + leave NULL-safe default.
4. Check other `customersRepository` usages and scope them the same way.

**Accept:** two different users uploading a "Müller GmbH" invoice end up with two distinct customer rows.

### P0-3. Access & refresh tokens are interchangeable and irrevocable
Same secret, same payload `{sub}`, no type claim:
- `auth.service.ts:93-102` (`generateTokens`) — access and refresh are identical JWTs with different expiries.
- `jwt.strategy.ts:23-29` accepts a refresh token as an access token.
- `auth.service.ts:74-91` refresh accepts an access token → a stolen 15-min token self-extends to 30 d forever. No revocation, no logout.

**Fix (minimal, do now):** add `type: 'access' | 'refresh'` to the payload; check it in `JwtStrategy` (reject non-access) and in `refreshTokens` (reject non-refresh). While there: `register` should return `ConflictException` (409), not `UnauthorizedException` (:27-29); normalize emails with `.toLowerCase().trim()` on register AND login (login is currently case-sensitive — frontend lowercases only at registration, `apps/frontend/src/lib/validation.ts`).
**Fix (follow-up, separate commit):** add `@nestjs/throttler` — strict limit on `auth/*` (e.g. 5/min), sane global default. Optional later: separate `JWT_REFRESH_SECRET` + store refresh-token hash in DB for revocation.

**Accept:** using a refresh token against `/documents` → 401; using an access token against `/auth/refresh` → 401.

### P0-4. Uploads: client Content-Type is trusted; limits are inconsistent in 3 places
- `documents.controller.ts:31-38` multer allows 20 MB + `image/webp`; `documents.service.ts:46-55` re-checks `MAX_FILE_SIZE` (default 10 MB) and `ALLOWED_FILE_TYPES` (default **without** webp) → webp uploads pass multer then die with 400; service check runs after the whole file is already in memory.
- No magic-byte validation: any file can be uploaded renamed as `.pdf`/`.png`.
- `s3Key` embeds the raw `file.originalname` (`documents.service.ts:59`) — unsanitized user input into the storage key.

**Fix:** single source of truth — one `UPLOAD_MIME_TYPES` / `MAX_UPLOAD_BYTES` shared by controller and service (drop the service re-check or make it env-driven and identical); decide webp once (recommend: allow, and add it to the frontend accept list `apps/frontend/src/app/upload/page.tsx:15-16`, which currently also caps at 10 MB ≠ backend 20 MB — align both). Add magic-byte sniffing (e.g. `file-type` pkg) before S3 upload → `UnsupportedMediaTypeException` on mismatch. Sanitize the filename: keep extension, base the key on `crypto.randomUUID()` (strip/normalize the original name).

---

## P1 — Data-correctness bugs

### P1-1. German dates get day/month swapped (silently)
`apps/backend/src/modules/ai/services/structured-extraction.service.ts:159-178` — `normalizeDate` tries `new Date(dateStr)` FIRST. V8 parses `"03.04.2026"` as MM.DD.YYYY → **4 March instead of 3 April**. Every German invoice with day ≤ 12 gets a wrong `invoice_date`/`due_date` stored and exported.

**Fix:** try the German regex `/(\d{2})\.(\d{2})\.(\d{4})/` FIRST; only fall back to `new Date()` for strict ISO `^\d{4}-\d{2}-\d{2}$`; return `null` otherwise. Add unit test: `03.04.2026 → 2026-04-03`, `25.12.2026 → 2026-12-25`, `2026-04-03 → 2026-04-03`.

### P1-2. German-formatted amounts parse to garbage
Same file, `normalizeExtraction` :136-143 — `parseFloat("1.200,50".replace(/[^\d.-]/g,''))` → `parseFloat("1.200,50")` → **1.2** (stops at the comma). "€1.200,50" becomes 1.20 in DB and Excel export; passes the `> 0` guard.

**Fix:** before parseFloat, normalize German format: if `/^-?\d{1,3}(\.\d{3})+,\d{2}$/` → strip `.` dots, replace `,`→`.`; if `/^-?\d+,\d{2}$/` → `,`→`.`. Then strip non-numeric. Unit test both formats plus plain `1200.50`.

### P1-3. OCR text normalization destroys line breaks → worse extraction
`apps/backend/src/modules/ocr/services/ocr.service.ts:260-270` — `.replace(/\s+/g, ' ')` collapses ALL newlines into spaces (and makes the `\n{3,}` rule on the next line dead code). The LLM receives one long line — line items lose their boundaries, which directly undermines extraction quality (roadmap S4).

**Fix:** collapse horizontal whitespace only: `.replace(/[ \t]+/g, ' ')`, keep single `\n`, collapse 3+ newlines to `\n\n`. Re-test one real scanned invoice: line items should still be extractable.

### P1-4. `deleteDocument`: S3 file deleted before DB — no transaction
`documents.service.ts:414-470` — deletes from R2 first; if any subsequent DB step fails, the record remains pointing at a deleted file. DB deletes are not wrapped in a transaction (invoice FK clearing → items → invoice → extractions → jobs → document).

**Fix:** wrap ALL DB deletes in one transaction (`dataSource.transaction` / query runner), commit, THEN delete from S3. If S3 delete fails after commit: log only (orphaned object is acceptable; the reverse is not).

### P1-5. No migrations; `db:migrate` DROPS THE SCHEMA
`apps/backend/package.json` — `"db:migrate": "schema:drop && schema:sync"` destroys the whole DB. No `database/migrations/` exists, `data-source.ts:64` points at a nonexistent dir, and `synchronize` is off in production → no deploy story.

**Fix:** delete/rename the destructive script (`db:reset` at minimum). Introduce TypeORM CLI migrations (`migration:generate`/`migration:run`/`migration:revert`, datasource export already exists). First migration: the P0-2 customers change. Set `synchronize: false` unconditionally once migrations are the only path.

### P1-6. DocumentViewer breaks after token expiry; no refresh path
`apps/frontend/src/components/DocumentViewer.tsx:31-55` — raw `fetch` with the localStorage token; when the 15-min access token expires the viewer fails, and the fallback "open in new tab" (`/documents/:id/file`) is unauthenticated → also fails. The axios interceptor never kicks in.

**Fix:** fetch the blob through `apiClient` (`responseType: 'blob'`, e.g. add `documentsApi.getFile(id)`) so the existing 401-refresh interceptor applies; create the object URL from that blob.

### P1-7. Extraction error handling contradicts itself
`document.processor.ts:410-418` — on extraction error the doc is set to `NEEDS_VALIDATION`, then the error rethrows and the outer catch overwrites it to `ERROR` (:224-229). Pick one: drop the inner status write (ERROR + retry/reprocess is the current UX) and keep only the log there.

### P1-8. pdf.js worker from a public CDN
`DocumentViewer.tsx:201` — worker loaded from `cdnjs.cloudflare.com`. Availability + CSP + supply-chain risk for a document app.

**Fix:** self-host: `pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()` (works with Next 15 / webpack asset modules), or copy the worker into `public/` at build.

---

## P2 — Robustness / hygiene

- **P2-1. `validateDocument` accepts untyped free-form fields** (`documents.service.ts:253-324`, `validate-document.dto.ts` is just `@IsObject()`). Truthy checks (`if (fields.invoice_number)`) make it impossible to clear a field; unknown keys silently ignored. Replace with an explicit optional-field DTO (strings + `YYYY-MM-DD` format + number amount) and support explicit `null` to clear.
- **P2-2. `updateDocumentStatus` allows any→any transitions** (`documents.service.ts:361-412`) — e.g. `validated → processing`. Define an allowed-transition map; move the magic `'unarchive'` body value to `POST /documents/:id/unarchive`; add a real DTO for the PATCH body (currently bypasses ValidationPipe via `@Body('status')`).
- **P2-3. Reprocess/cancel races:** `reprocessDocument` doesn't reject when status is already `processing` (duplicate jobs); `cancelByDocument` sets ANY document to `error` even with no active job. Guard both (409 on reprocess-while-processing; no-op when no pending/processing job). `document.processor.ts:221` `attempts = 1` on failure is a no-op oddity — remove.
- **P2-4. No transactions around extraction persistence** (`document.processor.ts:329-407`: invoice → items → extractions → document status). One crash mid-way leaves partial data. Wrap in a transaction.
- **P2-5. `S3Service.fileExists` downloads the whole object** (`s3.service.ts:147-168`) — use `HeadObjectCommand`.
- **P2-6. No env validation, inconsistent config access** — `JWT_SECRET` read via `process.env` in `auth.service.ts`, Redis via `process.env` in `app.module.ts:18-19`, ConfigService elsewhere. Add a ConfigModule `validationSchema` (Joi) that fails fast on missing `DATABASE_URL / JWT_SECRET / S3_* / GLM_API_KEY`; add `app.enableShutdownHooks()` in `main.ts` for graceful Bull drain. Also `DATABASE_URL` parsing regex (`data-source.ts:39`) breaks on URL-encoded/special-char passwords — use `new URL()` instead.
- **P2-7. Missing hardening:** no `helmet`, no API-wide rate limit (P0-3 adds auth-only throttler — extend globally later). Cheap wins, one commit.
- **P2-8. GDPR log noise:** `getDocument` debug logging dumps user IDs and ownership-miss details (`documents.service.ts:150-179`) — demote to `logger.debug` or remove; it was Bug-B debugging leftover.
- **P2-9. Dead code/deps:** `passport-local`, `zod` (backend), `uuid` (`crypto.randomUUID` is used), `canvas` (verify usage) in `apps/backend/package.json`; dead `UPLOADED` status (backend never persists it, dashboard still colors it, `page.tsx:443`); unused `normalizeNumbers/normalizeDates` in `ocr.service.ts` (remove or wire up); `apps/backend/scripts/_*.cjs` one-offs — move to `scripts/archive/` or delete.
- **P2-10. Numeric columns travel as strings:** pg returns `numeric(12,2)` as string; `api-client.ts` types `amount: number` (lie), `formatAmount(amount: number)` too. Either add an entity transformer or normalize in services; at minimum fix the TS types to `string | number` and parse in `formatAmount`.
- **P2-11. Next rewrites hardcode `localhost:3001`** (`apps/frontend/next.config.js:6-13`) — not deployable. Drive from `process.env.BACKEND_ORIGIN` (or drop rewrites and rely on `NEXT_PUBLIC_API_URL`).
- **P2-12. Google Fonts CSS @import duplicates next/font and leaks IPs to Google** (`apps/frontend/src/app/globals.css:1`) — `layout.tsx` already self-hosts Inter + Source Serif via `next/font`. Delete the `@import` line (GDPR: German courts treat font-CDN IP transfer as a violation; target market is DE).
- **P2-13. Zero tests.** Jest configured, no `*.spec.ts` anywhere; `test:e2e` points to a missing config. Minimum viable set after P0/P1: `normalizeDate`, `normalizeExtraction` (German formats), `normalizeText` (newlines), jobs ownership guard, customer scoping. These lock in the P1 fixes.

## UX / Frontend polish

- **U-1. Silent mutation failures:** `validate/reprocess/archive/delete/unarchive` mutations only `console.error` (`documents/[id]/page.tsx:102-149`). Add a minimal toast (or inline alert) for mutation errors — user currently gets zero feedback on failure.
- **U-2. Status is color-dot only on dashboard cards** (`page.tsx:441-451`) — add the text label (already i18n'd via `tStatus`), and add `error` to the dashboard status filter options (`statusOptions` :40-45 omits it).
- **U-3. Archived docs are hidden client-side after fetch** (`page.tsx:99-105`) — pages can render <20 rows while pagination says otherwise; an all-archived page shows "empty". Pass a server-side exclusion (new `include_archived=false` param or `status_ne`) instead of filtering client-side.
- **U-4. Line items are read-only and show a fabricated unit** — validate flow can't fix wrong items even though the total is editable; `unit` renders the default "Stk" that was never extracted (`documents/[id]/page.tsx:703-705`). Either extract `unit` in the LLM prompt or drop the column until then.
- **U-5. Upload page: fake progress (0→100 on success) and misaligned limits** — use axios `onUploadProgress` for real progress; align 10 MB/no-webp (`upload/page.tsx:15-16`) with the backend decision from P0-4.
- **U-6. Archive page search is client-side** (`archive/page.tsx:99` — filters already-loaded pages only, unlike dashboard's server search). Route it through `documentsApi.search` with `status: 'archived'`.
- **U-7. Auth UX:** register succeeded → tokens discarded, forced re-login (acceptable, but auto-login is 3 lines); login is case-sensitive on email until P0-3 normalization ships.
- **U-8. Dark mode is incomplete (known S2):** badge classes have no `.dark` variants (`globals.css:95-100`), upload/login pages barely covered. Do this AFTER P0/P1, as planned S2 — the audit items above take precedence.

## Notes (do not spend time)

- i18n key parity de/en is complete (202/202) — good.
- Both apps typecheck clean (`tsc --noEmit` exit 0).
- Export/search services are properly user-scoped; Excel styling is solid.
- Typecheck pipeline, correct FK-teardown pattern in delete/reprocess (well-documented), GLM retry/backoff — all in good shape.
- `README.md` has an uncommitted one-line fix by the main agent — leave it alone, commit it separately.
- CLAUDE.md drift: project-structure tree is mangled (frontend missing) and claims "Zod for request validation" (backend uses class-validator). Low priority doc fix.
