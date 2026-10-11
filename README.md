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

Built for the German market: handles German-language documents, DSGVO-compliant architecture.

## Key Features

- **PDF Ingestion** — Upload Rechnungen, Verträge, Angebote, Lieferscheine
- **AI Extraction Pipeline** — GLM-4.5-Flash by default (Zhipu/Z.ai) for structured extraction with per-field confidence
- **OCR Layer** — Tesseract for images and scanned/mixed PDFs
- **Background Jobs** — BullMQ + Redis queue for reliable async processing
- **Cloud Storage** — AWS S3 / Cloudflare R2 with presigned URLs
- **JWT Auth** — Secure multi-user authentication
- **Search & Export** — Server-side search and Excel export
- **DSGVO-ready** — Data handling designed for German compliance requirements
- **Demo-ready** — Public `/healthz` probe, rate-limited processing routes, idempotent demo seed with a synthetic (no-PII) sample invoice

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

Optional: seed a demo account and a synthetic sample invoice (no PII) for a
demo run — see [QUICK_START.md](./QUICK_START.md#verified-local-demo):

```bash
DEMO_EMAIL="demo@doclos.dev" DEMO_PASSWORD="change-me-demo-1234" pnpm demo:seed
```

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
