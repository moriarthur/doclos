# Doclos Backend - Cloud Setup Guide

> Run Doclos backend without Docker using cloud services

---

## Prerequisites

- Node.js >= 22.13.0
- pnpm >= 11.0.0
- Cloud accounts (see below)

---

## Cloud Services Setup

### 1. PostgreSQL Database (Supabase or Neon)

**Option A: Supabase (Recommended - Free Tier)**

1. Go to https://supabase.com
2. Sign up and create a new project
3. Get your connection string:
   - Project Settings → Database
   - Copy the "Connection string" (URI format)
   - Format: `postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres`

**Option B: Neon (Alternative)**

1. Go to https://neon.tech
2. Sign up and create a project
3. Get the connection string from the dashboard

### 2. Redis (Upstash Redis Cloud)

1. Go to https://upstash.com
2. Sign up and create a Redis database
3. Get the connection details:
   - REST API URL or Redis URL
   - Format: `redis://default:[PASSWORD]@[HOST].upstash.io:6379`

### 3. S3-Compatible Storage (Cloudflare R2 or AWS S3)

**Option A: Cloudflare R2 (Recommended - Free Tier)**

1. Go to https://dash.cloudflare.com → R2
2. Create a bucket (e.g., `doclos-documents`)
3. Get API Token:
   - R2 → Manage R2 API Tokens → Create API Token
   - Save Access Key ID and Secret Access Key
   - Endpoint: `https://[ACCOUNT-ID].r2.cloudflarestorage.com`

**Option B: AWS S3**

1. Go to AWS Console → S3
2. Create a bucket
3. Create IAM user with S3 access
4. Get Access Key ID and Secret Access Key

### 4. GLM API Key (Zhipu AI / Z.ai)

1. Go to https://open.bigmodel.cn/usercenter/apikeys
2. Sign up or login to Zhipu AI
3. Create a new API key
4. Copy the key

**GLM Models Available:**
- `glm-4.5-flash` - Default (free tier, hybrid reasoning; thinking disabled by default)
- `glm-4.7-flash` - Optional failover (thinks compulsively, rate-limits at peak)
- `glm-4-plus` / `glm-4-air` - Optional, higher cost

Note: `glm-4-flash` was removed from open.bigmodel.cn (error 1211, verified
2026-09-22) — do not use it.

---

## Environment Configuration

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Then update `.env` with your cloud credentials:

```env
# ============================================================================
# Cloud Services Configuration
# ============================================================================

# Database (Supabase) — use the IPv4 POOLER, not the direct db.* host
# (db.*.supabase.co is IPv6-only and fails on IPv4-only networks like WSL2).
# The app reads DATABASE_URL only. Session mode = port 5432; transaction mode = 6543.
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"

# TLS on the DB connection — certificate verification is ON. The Supabase
# pooler chain is issued by the private "Supabase Root 2021 CA", pinned via:
DB_CA_CERT_PATH="certs/supabase-prod-ca-2021.crt"

# Redis (Upstash — rediss:// enables TLS; local Docker uses redis://)
REDIS_URL="redis://default:[PASSWORD]@[HOST].upstash.io:6379"
REDIS_HOST="[HOST].upstash.io"
REDIS_PORT="6379"

# Storage (Cloudflare R2 or AWS S3)
S3_REGION="auto"  # For R2, use "auto"
S3_ENDPOINT="https://[ACCOUNT-ID].r2.cloudflarestorage.com"  # R2 endpoint
S3_BUCKET="doclos-documents"
S3_ACCESS_KEY_ID="[YOUR-ACCESS-KEY]"
S3_SECRET_ACCESS_KEY="[YOUR-SECRET-KEY]"

# AI Services - GLM (Zhipu AI / Z.ai)
# Get your API key from: https://open.bigmodel.cn/usercenter/apikeys
GLM_API_KEY="[YOUR-GLM-API-KEY]"
GLM_MODEL="glm-4.5-flash"
GLM_BASE_URL="https://open.bigmodel.cn/api/paas/v4"
GLM_THINKING_CLASSIFY="disabled"
GLM_THINKING_EXTRACT="disabled"

# ============================================================================
# Application Settings
# ============================================================================

JWT_SECRET="change-this-to-a-random-string-in-production"
JWT_ACCESS_EXPIRATION="15m"
JWT_REFRESH_EXPIRATION="30d"

APP_NAME="Doclos"
APP_ENV="development"
APP_PORT=3001
APP_URL="http://localhost:3001"
NODE_ENV="development"

# CORS / deployment wiring — see .env.example for the full contract
FRONTEND_URL="http://localhost:3000"     # the browser origin the backend allows
BACKEND_ORIGIN="http://localhost:3001"   # where the frontend proxies /api/v1/*

# ============================================================================
# Processing Configuration
# ============================================================================

# Confidence thresholds
CONFIDENCE_AUTO_ACCEPT="0.85"
CONFIDENCE_NEEDS_VALIDATION="0.60"
OCR_FALLBACK_THRESHOLD="0.70"

# File upload (informational — upload-constraints.ts is the runtime source of truth)
MAX_FILE_SIZE=20971520  # 20MB
ALLOWED_FILE_TYPES="application/pdf,image/png,image/jpeg,image/tiff,image/webp"

# Demo seed (optional — pnpm demo:seed creates/re-syncs one demo account)
DEMO_EMAIL="demo@doclos.dev"
DEMO_PASSWORD="change-me-demo-1234"

# ============================================================================
# OCR Settings
# ============================================================================
TESSERACT_LANGUAGES="deu+eng"
```

---

## Initial Setup

### 1. Initialize Database

The schema is created **via migrations only** — TypeORM `synchronize` is
disabled in the codebase. Apply them from `apps/backend`:

```bash
pnpm db:migrate
```

The baseline migration is idempotent, so it is also safe to run against a
database that was provisioned earlier (tables that already exist are
skipped). Schema changes go through `db:migration:generate` + `db:migrate` —
never `schema:sync`.

### 2. Create Storage Bucket

Make sure your S3/R2 bucket exists and is accessible.

### 3. Start the Backend

```bash
# From the project root
pnpm install
pnpm db:migrate

# Production-style start
pnpm build
cd apps/backend
pnpm start:prod
```

The API will be available at: `http://localhost:3001/api/v1`
Liveness probe (public, for platform health checks): `http://localhost:3001/healthz`

---

## Testing the API

### 1. Register a User

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123!",
    "name": "Test User"
  }'
```

### 2. Login

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "SecurePassword123!"
  }'
```

Save the `access_token` from the response for the next requests.

### 3. Upload a Document

```bash
curl -X POST http://localhost:3001/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@/path/to/document.pdf"
```

---

## Cloud Service Costs (Free Tiers)

| Service | Free Tier | Limits |
|---------|-----------|--------|
| **Supabase** | 500 MB database | 50,000 requests/month |
| **Neon** | 3 GB storage | 300 compute hours/month |
| **Upstash Redis** | 10,000 commands/day | Free forever |
| **Cloudflare R2** | 10 GB storage | 1M Class A operations/month |
| **GLM API (Z.ai)** | New user credits | ¥25 free credits (≈$3.50) |

**GLM Pricing (after free credits):**
- GLM-4.5-Flash (default): free tier, flash-family pricing ~¥0.1 / 1M tokens when billed
- GLM-4-Air: ¥0.5 / 1M tokens (~$0.07 / 1M tokens)
- GLM-4-Plus: ¥1.0 / 1M tokens (~$0.14 / 1M tokens)

---

## Troubleshooting

### Connection Issues

If you get database connection errors:
- Check your `DATABASE_URL` is correct
- Verify your Supabase project is active (not paused)
- Check your IP is allowed in Supabase settings

### Redis Connection Issues

- Verify the Upstash Redis URL is correct
- Check the database is active in Upstash dashboard

### S3 Upload Issues

- Verify your bucket exists
- Check your API token has proper permissions
- Verify the endpoint URL is correct

### AI Processing Issues

If document processing fails:
- Check `GLM_API_KEY` is set correctly
- Verify you have credits in your Zhipu AI account (https://open.bigmodel.cn/usercenter/balance)
- Check the backend logs for specific errors
- Try a different model via `GLM_MODEL` (e.g., `glm-4-air`) or check `GLM_FALLBACK_MODELS`

---

## Next Steps

1. **Set up cloud accounts** - Sign up for Supabase, Upstash, and Cloudflare R2
2. **Configure .env file** - Add your credentials
3. **Start the backend** - Run `pnpm run start:dev` in apps/backend
4. **Test the API** - Try the example requests above
5. **Build the frontend** - Install Next.js and connect to the backend

---

## Quick Reference URLs

- Supabase: https://supabase.com
- Neon: https://neon.tech
- Upstash: https://upstash.com
- Cloudflare R2: https://dash.cloudflare.com → R2
- Zhipu AI (GLM): https://open.bigmodel.cn
