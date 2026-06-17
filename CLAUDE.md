# Doclos - AI Document Automation SaaS

> Project: Document automation SaaS for small businesses and German Mittelstand
> Status: **Backend + Frontend MVP Complete** | Production ready
> Last Updated: 2026-06-17

---

## Project Overview

Doclos automatically processes business documents (invoices, contracts, offers, delivery notes) using OCR and AI to extract structured data for search, validation, and Excel export.

**Target Users:** Small companies, construction firms, service providers, accounting assistants, freelancers in Germany/EU
**Volume:** 50-500 documents per month

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 15, React, TypeScript, TailwindCSS, shadcn/ui, React Query, React Hook Form, Zod |
| **Backend** | NestJS, TypeScript |
| **Database** | PostgreSQL (Supabase) with JSONB, full-text search |
| **Queue** | Redis (Upstash) + BullMQ |
| **Storage** | Cloudflare R2 (S3-compatible) |
| **OCR** | Tesseract.js (German/English) |
| **AI** | **GLM-4.7-Flash (Zhipu AI / Z.ai)** - FREE model |
| **Workers** | Node.js background workers |
| **Testing** | Jest |
| **Monorepo** | Turborepo |

---

## Project Structure

```
doclos/
├── apps/
│   ├── backend/              # NestJS API ✅ COMPLETE & TESTED
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── auth/          # JWT auth, register/login ✅
│   │   │   │   ├── documents/     # Upload, list, validate ✅
│   │   │   │   ├── jobs/          # Job status, audit logs ✅
│   │   │   │   ├── storage/       # S3/R2 storage service ✅
│   │   │   │   ├── ocr/           # Tesseract OCR ✅
│       │   │   └── ai/            # GLM LLM integration ✅
│       │   ├── database/
│       │   │   ├── base.entity.ts ✅
│       │   │   └── data-source.ts ✅
│       │   ├── main.ts ✅
│       │   └── app.module.ts ✅
│       └── package.json ✅
├── packages/
│   └── shared/                # Shared types (empty - TODO)
├── docker/
│   └── docker-compose.yml     # PostgreSQL + Redis ✅
├── documentations/            # Parts 1-9 (architecture) ✅
├── .env ✅ (FULLY CONFIGURED - all credentials set)
├── .env.example ✅
├── turbo.json ✅
├── pnpm-workspace.yaml ✅
├── CLOUD_SETUP.md ✅          # Cloud services setup guide
├── QUICK_START.md ✅
└── CLAUDE.md                  # This file
```

---

## Database Entities (8 tables)

| Entity | Purpose | Status |
|--------|---------|--------|
| `users` | Authentication, OAuth | ✅ Complete |
| `customers` | Companies from documents | ✅ Complete |
| `documents` | Uploaded files, status | ✅ Complete |
| `invoices` | Structured invoice data | ✅ Complete |
| `invoice_items` | Line items | ✅ Complete |
| `jobs` | Background job tracking | ✅ Complete |
| `audit_logs` | GDPR compliance | ✅ Complete |
| `field_extractions` | OCR/LLM results with confidence | ✅ Complete |

---

## API Endpoints (ALL IMPLEMENTED & TESTED)

### Authentication
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - Email/password login
- `POST /api/v1/auth/refresh` - Refresh token

### Documents
- `POST /api/v1/documents/upload` - Multipart file upload
- `GET /api/v1/documents` - List with pagination (status, company, date filters)
- `GET /api/v1/documents/:id` - Document details with signed URL
- `PATCH /api/v1/documents/:id/validate` - Correct AI-extracted values
- `POST /api/v1/documents/:id/reprocess` - Re-run AI pipeline

### Jobs
- `GET /api/v1/jobs/:id` - Job status with progress

### TODO (Not implemented)
- `GET /api/v1/search` - Search API
- `GET /api/v1/export/excel` - Excel export

---

## Document Processing Pipeline (IMPLEMENTED)

```
Upload → S3 → Queue → Download → OCR (Tesseract) → Classify (GLM) → Extract (GLM) → Score → Validate → Persist
```

**Document Status Flow:**
`uploaded` → `processing` → `parsed` → `needs_validation` → `validated` → `archived`

**Confidence Thresholds:**
- `> 0.85`: Auto-accept → `parsed`
- `0.60 - 0.85`: Manual validation → `needs_validation`
- `< 0.60`: Low confidence → `needs_validation`

---

## GLM AI Integration (Zhipu AI / Z.ai)

**API:** https://open.bigmodel.cn/api/paas/v4

**Models Used:**
- `glm-4-flash` - Fast, cost-effective (default for document processing)
- `glm-4-air` - Balanced performance
- `glm-4-plus` - Complex extraction
- `glm-4` - Standard

**Pricing:** ¥0.1 / 1M tokens (glm-4-flash)

**Features:**
- Document classification (invoice, contract, offer, delivery_note)
- Structured invoice extraction (all fields with confidence)
- Per-field confidence scoring

---

## OCR Processing (Tesseract.js)

**Languages:** German (deu) + English (eng)

**Pipeline:**
1. Extract embedded text from PDF (fastest)
2. Fallback to OCR for scanned/mixed PDFs
3. Image preprocessing (grayscale, threshold, noise removal)
4. Per-page processing with confidence tracking

**Categories Detected:**
- `text_pdf` - Has embedded text
- `scanned_pdf` - Images only
- `mixed_pdf` - Both text and images
- `image_document` - PNG/JPG/TIFF

---

## Cloud Services Configuration (ALL SET UP ✅)

### Current Configuration

Credentials live in `.env` (gitignored — never commit real secrets). Copy
`.env.example` and fill in your own values for: `DATABASE_URL`, `REDIS_URL`,
`S3_*`, `GLM_API_KEY`, `JWT_SECRET`.

> ⚠️ **Security note:** real credentials were accidentally committed to this
> file (and thus to git history) while the repo was public. They have been
> removed here, but they must be considered compromised — **rotate ALL secrets**
> (Supabase DB password, R2 keys, GLM key, JWT secret) regardless.

### Free Tiers Used
| Service | Plan | Status |
|---------|-------|--------|
| **Supabase** | 500 MB database | ✅ Connected |
| **Upstash Redis** | 10K commands/day | ✅ Connected |
| **Cloudflare R2** | 10 GB storage | ✅ Connected |
| **GLM (Z.ai)** | ¥25 credits | ✅ Ready |

---

## Build & Run

**From project root:**
```bash
# Install dependencies
pnpm install

# Start backend (development mode)
cd apps/backend
pnpm run start:dev

# Server runs on: http://localhost:3001/api/v1
```

**Build:**
```bash
cd apps/backend
pnpm run build
```

---

## Coding Standards

- **TypeScript strict mode** with definite assignment assertions (`property!`)
- **ESLint + Prettier** for formatting
- **Zod** for request validation
- **Modular architecture** - Each module handles its domain
- **Comments** reference documentation source (e.g., `// Part 4: API Spec`)

---

## Development Workflow

When working on Doclos:

1. Use **Serena plugin** for all file operations (symbol-level tools preferred)
2. Use **AskUserQuestion** for ambiguities before making decisions
3. Break complex tasks into subtasks
4. Track progress using task system
5. Reference documentation in `documentations/` folder (Parts 1-9)

---

## Supported Languages

English, German (i18n via next-i18next) - TODO: Not implemented yet

---

## Cost Optimization

- GLM-4-Flash: ¥0.1 / 1M tokens (very cost-effective)
- OCR first before LLM (reduces token usage)
- Tesseract OCR (no cost) vs cloud OCR fallback
- Streaming Excel export for large datasets

---

## Key Files

| File | Purpose |
|------|---------|
| `.env` | Environment variables (FULLY CONFIGURED) |
| `.env.example` | Template with all options documented |
| `CLOUD_SETUP.md` | Guide for cloud services setup |
| `QUICK_START.md` | Quick start guide for local development |
| `turbo.json` | Turborepo configuration |
| `pnpm-workspace.yaml` | pnpm workspace configuration |
