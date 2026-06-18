# Doclos Backend - Cloud Setup Guide

> Run Doclos backend without Docker using cloud services

---

## Prerequisites

- Node.js >= 20.0.0 ✅ (You have this)
- pnpm >= 8.0.0 ✅ (You have this)
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
- `glm-4-flash` - Fast, cost-effective (recommended for document processing)
- `glm-4-plus` - More capable, higher cost
- `glm-4-air` - Balanced performance
- `glm-4` - Standard model

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
DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[YOUR-PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

# Redis (Upstash)
# Replace with your Redis URL
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
GLM_MODEL="glm-4-flash"  # Options: glm-4-flash, glm-4-plus, glm-4-air, glm-4
GLM_BASE_URL="https://open.bigmodel.cn/api/paas/v4"

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
FRONTEND_URL="http://localhost:3000"

# ============================================================================
# Processing Configuration
# ============================================================================

# Confidence thresholds
CONFIDENCE_AUTO_ACCEPT="0.85"
CONFIDENCE_NEEDS_VALIDATION="0.60"
OCR_FALLBACK_THRESHOLD="0.70"

# File upload
MAX_FILE_SIZE=10485760  # 10MB
ALLOWED_FILE_TYPES="application/pdf,image/png,image/jpeg,image/tiff"

# ============================================================================
# OCR Settings
# ============================================================================
TESSERACT_LANGUAGES="deu+eng"
```

---

## Initial Setup

### 1. Initialize Database

The database tables will be created automatically on first run (TypeORM synchronize).

For production, you should disable auto-sync and use migrations:

```env
# In production, set this to false
NODE_ENV="production"
```

### 2. Create Storage Bucket

Make sure your S3/R2 bucket exists and is accessible.

### 3. Start the Backend

```bash
# From the project root
pnpm install

# Start the backend in development mode
cd apps/backend
pnpm run start:dev
```

The API will be available at: `http://localhost:3001/api/v1`

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
- GLM-4-Flash: ¥0.1 / 1M tokens (~$0.014 / 1M tokens) - Most cost-effective
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
- Try switching to a different GLM model (e.g., `glm-4-air` instead of `glm-4-flash`)

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
