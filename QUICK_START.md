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
# Create schema from entities (dev only), then apply migrations
cd apps/backend
pnpm db:reset && pnpm db:migrate
```

### 5. Start development

```bash
# Start backend
cd apps/backend
npm run start:dev
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

Start the backend from `apps/backend` with the local database explicitly
selected. This is useful when `.env` normally points at Supabase:

```bash
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

Open `http://localhost:3000/login` and demonstrate:

1. Register or log in.
2. Upload `1000+ PDF_Invoice_Folder/invoice_Sample Company A_8884.pdf`.
3. Wait for processing to finish.
4. Open the result, review the flagged consistency issue, and confirm the data.
5. Download the Excel export.

The expected demo path is `processing` → `needs_validation` → `validated`.
The review step is intentional: Doclos exposes uncertain or inconsistent AI
results instead of silently accepting them.

## API Endpoints

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
