# Doclos - Quick Start Guide

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 8.0.0
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
# Create database schema
cd apps/backend
npx typeorm schema:sync -d src/database/data-source.ts
```

### 5. Start development

```bash
# Start backend
cd apps/backend
npm run start:dev
```

The API will be available at `http://localhost:3001/api/v1`

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
├── packages/
│   └── shared/            # Shared types (future)
├── docker/
│   └── docker-compose.yml
└── turbo.json
```

## Development Status

Backend + Frontend MVP is complete and production-verified:

- ✅ Turborepo monorepo structure
- ✅ NestJS backend (API on :3001)
- ✅ PostgreSQL (Supabase) + Redis (Upstash)
- ✅ Authentication (JWT register/login/refresh)
- ✅ Document upload API
- ✅ Document processing queue (BullMQ)
- ✅ OCR (Tesseract.js, German + English)
- ✅ LLM extraction (GLM-4.7-Flash / Z.ai)
- ✅ Document validation & reprocess API
- ✅ Cloudflare R2 storage (signed URLs)
- ✅ Database entities (8 tables)
- ✅ Frontend (Next.js + React + shadcn/ui)

## Next Steps

Not yet implemented (see `CLAUDE.md` for the full picture):

1. Search API (`GET /api/v1/search`)
2. Excel/CSV/JSON export (`GET /api/v1/export/excel`)
3. Scanned-PDF OCR — PDF→image conversion not yet wired up (image-only PDFs error out)
4. i18n (English/German via next-i18next)
5. OAuth (Google/Microsoft)
