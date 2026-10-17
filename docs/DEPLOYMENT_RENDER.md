# Deployment — Render (public demo preview)

> Decisions locked by the user (2026-10-15): **Upstash Redis (EU, TLS) is the
> primary Redis provider** — Render Key Value is fallback-only. Backend and
> frontend are **two Render Web Services** (existing Next.js server model).
> Cloudflare stays for R2/DNS/TLS only; no Cloudflare Pages/Workers migration.
>
> Nothing here creates resources automatically — every step is manual,
> dashboard-first. No secret values appear in this document.

## 0. Prerequisites (rotate first — see SECRETS_ROTATION.md)

- Supabase project reachable; **DB password rotated**; `DATABASE_URL` ready
  (transaction pooler, IPv4, TLS via the pinned CA
  `apps/backend/certs/supabase-prod-ca-2021.crt`).
- Cloudflare R2 bucket **private** (no public access, no custom-domain
  publishing) + a fresh API token (Object Read & Write on that bucket only).
- Z.ai/GLM key.
- Upstash account: create a **Regional (EU) Redis (Free tier)** — copy the
  `rediss://` URL from the console; never commit or print it.

## 1. Render blueprint — backend (Web Service)

| Setting | Value |
|---|---|
| Service type | Web Service (Docker off — runtime: Node) |
| Repo / branch | this repo / `main` (after merge) |
| Region | Frankfurt (EU) — close to Supabase + Upstash |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @doclos/backend build` |
| Pre-deploy command | `pnpm db:migrate` |
| Start command | `pnpm --filter @doclos/backend start:prod` |
| Health check path | `/healthz` |
| Instance | Free tier is enough for the demo (spins down when idle — first request is slow) |

Backend environment variables (Render dashboard → Environment):

```
NODE_ENV=production
PORT            # injected by Render automatically — the app reads it first
DATABASE_URL=postgresql://…pooler.supabase.com:6543/postgres   # value only in Render
DB_CA_CERT_PATH=certs/supabase-prod-ca-2021.crt
REDIS_URL=rediss://default:<value>@<host>.upstash.io:6379      # value only in Render
JWT_SECRET=<32–64 random chars — generate with `openssl rand -base64 48`>
JWT_ACCESS_EXPIRATION=15m
JWT_REFRESH_EXPIRATION=30d
FRONTEND_URL=https://<frontend-service>.onrender.com
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=<bucket>
S3_ACCESS_KEY_ID=<value>
S3_SECRET_ACCESS_KEY=<value>
S3_SIGNED_URL_EXPIRATION=900
GLM_API_KEY=<value>
GLM_MODEL=glm-4.5-flash
GLM_THINKING_CLASSIFY=disabled
GLM_THINKING_EXTRACT=disabled
TRUST_PROXY_HOPS=1
# optional:
# DEMO_RETENTION_DAYS=14
```

Notes:
- `TRUST_PROXY_HOPS=1` — Render fronts the service with exactly one reverse
  proxy; req.ip resolves from the trusted hop only.
- The pinned CA file is in the repo (`apps/backend/certs/`), so
  `DB_CA_CERT_PATH=certs/supabase-prod-ca-2021.crt` needs no secret file
  upload.
- `APP_PORT` is unnecessary — `resolvePort()` reads `PORT` first.

## 2. Render blueprint — frontend (Web Service)

| Setting | Value |
|---|---|
| Service type | Web Service (Next.js server — NOT static: middleware + the `/api/v1` rewrite need the server) |
| Region | Frankfurt (EU) |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @doclos/frontend build` |
| Start command | `pnpm --filter @doclos/frontend start` |
| Health check path | `/` |

Frontend environment variables:

```
NODE_ENV=production
BACKEND_ORIGIN=https://<backend-service>.onrender.com
# NEXT_PUBLIC_API_URL — leave UNSET (same-origin proxy; no backend secrets
# ever go into NEXT_PUBLIC_*)
```

Why Render (not Vercel/Cloudflare Pages): the app relies on `middleware.ts`
(auth redirects) and the same-origin `/api/v1/*` rewrite to `BACKEND_ORIGIN` —
both need a running Next server, and the cookie-based session transport
depends on first-party cookies from the frontend origin. Render runs the
existing model as-is; no code or architecture change (user-confirmed
decision).

## 3. Order of operations (first deploy)

1. Rotate all secrets (SECRETS_ROTATION.md).
2. Create the Upstash EU Redis instance → copy `rediss://` URL.
3. Create both Render services with the commands/env above (frontend needs
   the backend's `.onrender.com` URL — create the backend first).
4. Trigger the backend deploy — the pre-deploy command runs
   `pnpm db:migrate` (idempotent, verified on clean Postgres in CI).
5. Verify: `curl https://<backend>.onrender.com/healthz` → `{"status":"ok"}`,
   `…/readyz` → all checks `ok`.
6. Open the frontend, register, **Load synthetic sample**, watch it process.
7. Run the smoke suite from your machine:
   `FRONTEND_URL=https://<frontend>.onrender.com BACKEND_ORIGIN=https://<backend>.onrender.com node scripts/smoke-demo.mjs`
   (see POST_DEPLOY_SMOKE.md).

## 4. Operational notes

- **Free-tier spin-down**: both services sleep when idle; the first request
  pays a cold start (~30–60 s). The smoke script's first steps may need a
  retry on a cold instance.
- **Render Key Value fallback**: if Upstash is unavailable, a Render Key
  Value (redis:// URL) works with the same `REDIS_URL` variable — the app
  parses any redis/rediss URL. Upstash remains the primary choice (EU region,
  free tier, TLS).
- **Redis is not load-bearing**: if Redis dies, uploads fail closed (queue
  unavailable) but the boot-time recovery sweep requeues any stale
  `processing` documents after restart; rate limits fail open (documented
  defense-in-depth).
- **No destructive commands against production**: migrations only, never
  `db:reset:dev` against a hosted database.
- Logs: request lines carry method/path/status/duration + correlation ID only;
  provider error bodies are redacted. Render log streams are safe to share on
  that basis — still, treat them as internal.
