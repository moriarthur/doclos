# Post-deploy smoke test

> Run after every first deploy of a new environment (and after any deploy that
> touched auth, quotas, or the pipeline). The script drives the REAL pipeline
> (GLM + R2 + Postgres + Redis) — expect a handful of GLM calls and one small
> synthetic object in the bucket.

## What it verifies

Frontend load → `/healthz` → `/readyz` → registration (two isolated users,
uniform response without token material) → login (HttpOnly cookies) →
synthetic sample through the real pipeline → **tenant isolation** (user B
sees none of user A's documents) → processing completion → document detail
with a presigned URL → original file download → Excel export → logout →
**revoked-session rejection** (refresh + API after logout → 401).

Random credentials are generated in-memory and never printed; output shows
step names, statuses and document IDs only.

## Run

```bash
# local production-style run:
BACKEND_ORIGIN=http://localhost:3001 node scripts/smoke-demo.mjs http://localhost:3000

# deployed environment:
FRONTEND_URL=https://<frontend>.onrender.com \
BACKEND_ORIGIN=https://<backend>.onrender.com \
node scripts/smoke-demo.mjs
```

Exit code 0 = all steps passed. On a free-tier cold start the first request
may time out — rerun once the instance is awake.

## Manual spot checks (optional)

```bash
curl -s https://<backend>.onrender.com/healthz
curl -s https://<backend>.onrender.com/readyz
```

`/readyz` must answer `{"status":"ok","checks":{"postgres":"ok","redis":"ok","storage":"ok"},…}`.
If `redis` is `fail`: check the Upstash URL in Render; if `storage` is `fail`:
check the R2 env vars. Neither endpoint prints any values by design.

## Rate-limit awareness

The smoke run consumes budget (registration 3/h/IP, sample 1/day/user).
Re-running it within an hour will hit 429s — that's the protection working;
wait or lift budgets consciously.
