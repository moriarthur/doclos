<div align="center">

# Doclos

### AI-Powered Document Automation for German Mittelstand

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![NestJS](https://img.shields.io/badge/NestJS-E0234E?style=flat&logo=nestjs&logoColor=white)](https://nestjs.com)
[![Next.js](https://img.shields.io/badge/Next.js-000000?style=flat&logo=next.js&logoColor=white)](https://nextjs.org)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat&logo=postgresql&logoColor=white)](https://postgresql.org)

*Automatically process invoices, contracts, offers and delivery notes — extract structured data from PDFs into a searchable database.*

</div>

---

## What it does

Doclos is a SaaS platform that automates business document processing for small businesses. Upload a PDF invoice, contract, offer, or delivery note — the AI pipeline extracts key data (dates, amounts, parties, line items) and stores it in a structured, searchable format.

Built for the German market: handles German-language documents, with data handling designed toward DSGVO requirements (public demo preview — see the notice below).

## Key Features

- **PDF Ingestion** — Upload Rechnungen, Verträge, Angebote, Lieferscheine
- **AI Extraction Pipeline** — GLM-4.5-Flash by default (Zhipu/Z.ai) for structured extraction with per-field confidence
- **OCR Layer** — Tesseract for images and scanned/mixed PDFs
- **Background Jobs** — BullMQ + Redis (Upstash) queue for reliable async processing
- **Cloud Storage** — AWS S3 / Cloudflare R2 with short-lived presigned URLs
- **Session Auth** — HttpOnly-cookie sessions with rotation, reuse detection and server-side logout
- **Search & Export** — Server-side search and Excel export
- **DSGVO-ready demo** — data handling designed toward German compliance requirements (demo status — see the notice below)
- **Public demo preview** — every visitor registers an isolated account, loads a synthetic (no-PII) sample in-product, per-user quotas + rate limits

## ⚠️ MVP demo notice — please read before signing up

This is a **public MVP demo preview**, not a production service:

- **Upload only synthetic or non-confidential documents.** Anything you upload may be processed by an external AI provider (Z.ai/GLM) and stored on cloud infrastructure.
- Each account is isolated per user; **demo data may be deleted automatically** (retention sweep for inactive accounts, `DEMO_RETENTION_DAYS`).
- **Delete your account anytime**: log in → Profile → *Delete account* (frontend control ships with the demo preview; the API endpoint is `DELETE /api/v1/account`). This erases your documents, extractions, jobs and storage objects.
- **Privacy notice / retention / imprint**: placeholder sections live in [QUICK_START.md](./QUICK_START.md#demo-privacy-retention-imprint) until legal entities are in place. This demo is "DSGVO-ready", not DSGVO-certified — no contract, no AVV, no certified deletion concept yet.

## Architecture

```
doclos/
├── apps/
│   ├── backend/              # NestJS API (REST)
│   │   └── src/modules/
│   │       ├── ai/           # AI extraction pipeline
│   │       ├── auth/         # JWT authentication
│   │       ├── documents/    # Document CRUD & processing
│   │       ├── jobs/         # Background job management
│   │       ├── ocr/          # OCR processing (Tesseract)
│   │       └── storage/      # S3/R2 file storage
│   └── frontend/             # Next.js dashboard UI
├── docker/                   # Docker Compose setup
├── documentations/           # 9-part architecture documentation
└── turbo.json                # Turborepo build pipeline
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js, React, Tailwind CSS |
| Backend | NestJS, TypeScript |
| Database | PostgreSQL |
| Queue | Redis, BullMQ |
| Storage | AWS S3 / Cloudflare R2 |
| AI | GLM-4.5-Flash by default (Zhipu/Z.ai) |
| OCR | Tesseract |
| Build | Turborepo, pnpm workspaces |
| Infra | Docker, Docker Compose |

## Getting Started

```bash
# Prerequisites: Node ≥ 22.13, pnpm ≥ 11, Docker

# Clone and install
git clone https://github.com/moriarthur/doclos.git
cd doclos
pnpm install

# Start infrastructure (PostgreSQL + Redis)
docker compose -f docker/docker-compose.yml up -d

# Configure environment
cp .env.example .env
# Fill in: DATABASE_URL, REDIS_URL, JWT_SECRET, S3_*, GLM_API_KEY

# Apply migrations (never needs a destructive reset)
pnpm db:migrate

# Start development (backend :3001 + frontend :3000)
pnpm dev
```

Optional (demo presentations): each presenter registers an isolated account
in the UI and clicks **Load synthetic sample** — a fictional, no-PII invoice
processed through the real pipeline. No shared demo account exists; see
[QUICK_START.md](./QUICK_START.md#verified-local-demo).

## Development

```bash
pnpm lint          # turbo: read-only eslint in both apps (backend also has lint:fix)
pnpm test          # backend Jest suite (106 tests)
pnpm exec tsc --noEmit -p apps/backend    # typecheck backend
pnpm exec tsc --noEmit -p apps/frontend   # typecheck frontend
pnpm build         # production builds (backend dist/ + frontend .next/)
```

CI (GitHub Actions) runs install with `--frozen-lockfile`, typechecks, the
backend suite, lint without `--fix`, and both production builds on every push
and PR.

## Documentation

Full architecture documentation available in [`documentations/`](./documentations/):

1. AI Document Automation — Concept & Pipeline
2. AI Pipeline — Detailed Processing Flow
3. API Specification
4. Frontend Architecture
5. Excel Export System
6. Security & DSGVO
7. Infrastructure & Deployment
8. Development System

## License

This project is licensed under the [MIT License](./LICENSE).

---

<div align="center">

*Built with [Claude Code](https://claude.ai/code) — AI-native development workflow*

</div>
