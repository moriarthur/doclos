# Doclos - Quick Start Guide

## Prerequisites

- Node.js >= 22.13.0 (required by the current pnpm 11 toolchain)
- pnpm >= 11.0.0
- Docker and Docker Compose

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start infrastructure (PostgreSQL + Redis)

```bash
docker-compose -f docker/docker-compose.yml up -d
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Initialize database

```bash
# Apply all migrations — creates the complete schema from scratch.
# A destructive reset is never part of setup (db:reset:dev exists for
# local development only).
cd apps/backend
pnpm db:migrate
```

### 5. Start development

```bash
# Start backend
cd apps/backend
pnpm run start:dev
```

The API will be available at `http://localhost:3001/api/v1`

## Verified local demo

Use this path for a live presentation. It keeps PostgreSQL and Redis local,
while the configured R2 and GLM credentials in `.env` provide real file
storage and AI processing.

Start infrastructure:

```bash
docker compose -f docker/docker-compose.yml up -d
```

Seed the demo account and the synthetic sample invoice (idempotent — safe to
re-run; uses `DEMO_EMAIL` / `DEMO_PASSWORD` from the environment or `.env`):

```bash
pnpm demo:seed
# ✅ demo user created: demo@doclos.dev
# ✅ synthetic sample invoice written: apps/backend/seeds/sample-invoice.pdf
```

Build, then start the backend from `apps/backend` with the local database
explicitly selected. This is useful when `.env` normally points at Supabase:

```bash
pnpm build
cd apps/backend
DATABASE_URL='postgresql://doclos:doclos_dev_password@localhost:5432/doclos' \
REDIS_URL='redis://localhost:6379' \
REDIS_HOST=localhost REDIS_PORT=6379 \
pnpm start:prod
```

In a second terminal, start the already-built frontend:

```bash
cd apps/frontend
pnpm start
```

Sanity checks: `http://localhost:3001/healthz` answers `{"status":"ok"}` and
the frontend loads on `http://localhost:3000` without any `localhost:3001`
references in the browser console (the frontend proxies `/api/v1/*` to
`BACKEND_ORIGIN`).

Demonstrate (`demo@doclos.dev` / your `DEMO_PASSWORD`):

1. Log in with the demo account.
2. Upload `apps/backend/seeds/sample-invoice.pdf` — a fully synthetic
   invoice (fictional "Beispielbau GmbH" data, no PII).
3. Wait for processing to finish.
4. Open the result, review the flagged consistency issue, and confirm the data.
5. Download the Excel export.

The expected demo path is `processing` → `needs_validation` → `validated`.
The review step is intentional: Doclos exposes uncertain or inconsistent AI
results instead of silently accepting them.

Between demo runs, wipe everything the demo account created (other accounts
are never touched):

```bash
pnpm demo:reset   # then re-run pnpm demo:seed if you want the sample file rewritten
```

## Demo preview deployment

Production-style run of a clean clone (what the CI builds and what a demo
host executes):

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate                          # migrations only — no destructive reset
cd apps/backend && pnpm start:prod       # API on :3001, GET /healthz for probes
cd apps/frontend && pnpm start           # UI on :3000
```

Environment contract (see `.env.example` for the full set):

| Variable | Who reads it | Purpose |
|----------|--------------|---------|
| `BACKEND_ORIGIN` | frontend server | target of the `/api/v1/*` rewrite — set to the backend's public URL |
| `NEXT_PUBLIC_API_URL` | browser bundle | leave **unset** for same-origin deployments; set only for a separate API domain |
| `FRONTEND_URL` | backend CORS | the one browser origin allowed in production |
| `DEMO_EMAIL` / `DEMO_PASSWORD` | `pnpm demo:seed` | demo account credentials (12+ char password) |

Demo-safety built in: uploads and reprocesses are rate-limited to 10
requests/min/IP (auth: 10/min, everything else: 120/min), uploads are capped
at 20 MB with magic-byte sniffing, and `GLM_THINKING_EXTRACT` defaults to
`disabled` so extraction stays fast and deterministic.

## API Endpoints

### Health

- `GET /healthz` - Liveness probe (public, no prefix, no auth)

### Authentication

- `POST /api/v1/auth/register` - Register new user
- `POST /api/v1/auth/login` - Login
- `POST /api/v1/auth/refresh` - Refresh access token

### Documents

- `POST /api/v1/documents/upload` - Upload document
- `GET /api/v1/documents` - List documents
- `GET /api/v1/documents/:id` - Get document details
- `PATCH /api/v1/documents/:id/validate` - Validate extracted data
- `POST /api/v1/documents/:id/reprocess` - Reprocess document

### Jobs

- `GET /api/v1/jobs/:id` - Get job status

## Example Usage

### Register a user

```bash
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!",
    "name": "Test User"
  }'
```

### Login

```bash
curl -X POST http://localhost:3001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "password": "SecurePassword123!"
  }'
```

### Upload a document

```bash
curl -X POST http://localhost:3001/api/v1/documents/upload \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@/path/to/document.pdf"
```

## Project Structure

```
doclos/
├── apps/
│   └── backend/           # NestJS API
│       ├── src/
│       │   ├── modules/
│       │   │   ├── auth/          # Authentication
│       │   │   ├── documents/     # Document management
│       │   │   └── jobs/          # Background jobs
│       │   └── database/          # Database entities
│       └── package.json
├── docker/
│   └── docker-compose.yml
└── turbo.json
```

## Current MVP Status

The core demo workflow is implemented and covered by backend tests:

- ✅ Turborepo monorepo structure
- ✅ NestJS backend (API on :3001)
- ✅ PostgreSQL (Supabase) + Redis (local Docker by default)
- ✅ Authentication (JWT register/login/refresh)
- ✅ Document upload API
- ✅ Document processing queue (BullMQ)
- ✅ OCR (Tesseract.js, German + English) for images and scanned/mixed PDFs
- ✅ LLM extraction (GLM-4.5-Flash by default / Z.ai, configurable fallback)
- ✅ Document validation & reprocess API
- ✅ Cloudflare R2 storage (signed URLs)
- ✅ Database entities and TypeORM migrations
- ✅ Frontend (Next.js + React + Tailwind UI)
- ✅ Server-side search and Excel export

## Deliberate MVP Boundaries

The following are intentionally outside the MVP:

1. CSV/JSON export (Excel is implemented)
2. OAuth (Google/Microsoft)
3. Cloud-OCR fallback for difficult handwriting or very poor scans
4. Account-wide GDPR erasure endpoint
