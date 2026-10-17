# Secrets Rotation Runbook (pre-deploy, manual)

> Why: while the repo was public, real credentials were committed and are in
> git history. They are considered compromised **regardless of any later
> cleanup**. Rotate everything below **before** the first production deploy.
> This document intentionally contains no secret values — only where each
> secret lives and how to rotate it.

## Rotate before first production deploy

| Secret | Where it is used | How to rotate | Notes |
|--------|------------------|---------------|-------|
| Supabase DB password | `DATABASE_URL` (backend + migrations + `enable-rls.cjs`) | Supabase Dashboard → Project Settings → Database → **Reset database password** | Updates `DATABASE_URL` in every environment; running app instances must be restarted after. TLS: keep `DB_CA_CERT_PATH` pointing at `apps/backend/certs/supabase-prod-ca-2021.crt`. |
| Cloudflare R2 access key ID | `S3_ACCESS_KEY_ID` | Cloudflare Dashboard → R2 → **Manage R2 API Tokens** → roll the token (create new, then delete old) | Bucket policy unchanged; new token must keep Object Read & Write on the same bucket. |
| Cloudflare R2 secret access key | `S3_SECRET_ACCESS_KEY` | same token roll as above | Rotate together with the access key ID (they are one credential). |
| Z.ai / GLM API key | `GLM_API_KEY` | Z.ai console → API keys → create new key, update `GLM_API_KEY`, then delete the old key | Old key can be deleted only after the new key is live in the running deployment. |
| JWT secret | `JWT_SECRET` | generate 32–64 random chars (`openssl rand -base64 48`) | Rotating invalidates **all** sessions (users must log in again). Production boot **refuses** secrets < 32 chars or the placeholder `your-super-secret-jwt-key-change-in-production` (see `app.module.ts` validation). |
| Any real OpenAI / Google credentials if present | n/a — none found in the tracked tree (scan 2026-10-15) | revoke in the provider console if they exist and are no longer needed | Only relevant for forks/older clones. |

## Git history exposure

Real credentials committed before 2026-09-22 remain in git history. Options:

1. **Accepted risk + rotation (chosen):** rotate every credential above; old
   history values become dead. No history rewrite without an explicit,
   separate user decision (per repo workflow).
2. History rewrite (filter-repo / BFG) is possible but invalidates every
   clone and is **not** planned.

## Hygiene rules enforced by this repo

- `.env` is gitignored; only `.env.example` (placeholders only) is tracked.
- Never print secret values in terminals, logs, diffs, commit messages, or
  reports — including this project's own docs.
- Production boot fails fast on missing/placeholder/weak secrets
  (`ConfigModule` `validationSchema` in `apps/backend/src/app.module.ts`).
- Placeholder values are **forbidden in production** — the backend refuses to
  boot with the placeholder JWT secret or the legacy demo password value.
