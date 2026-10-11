# Documentation — Status Disclaimer

The files in `documentations/` (Parts 1–9) are the **original pre-build design
specification** for Doclos. They were written *before* implementation to plan
the architecture, data model, API, and processing pipeline.

They are kept as a **historical design reference**, **not** as a description of
the current system. The implementation has diverged from the spec in several
ways:

- **Source of truth for current status** is [`/CLAUDE.md`](../CLAUDE.md) and the
  code under `apps/`. When the docs and the code disagree, **the code wins**.
- **AI model:** the LLM is **GLM-4.5-Flash** by default, with a configurable
  fallback model (Zhipu AI / Z.ai), *not* Claude or OpenAI GPT as Parts 1–3
  originally speculate.
- **OCR:** Tesseract.js (deu + eng) with Sharp preprocessing. PDF→image
  conversion for scanned and mixed PDFs is implemented. Cloud-OCR fallback
  (Google Vision / AWS Textract) remains out of scope.
- **Implemented since the original spec:** Search API
  (`GET /api/v1/search`), Excel export (`GET /api/v1/export/excel`), and the
  current German/English UI. CSV/JSON export, OAuth (Google/Microsoft),
  Swagger/OpenAPI (`/api/docs`), and `DELETE /api/v1/account` (GDPR erasure)
  remain out of scope.
- Minor API shapes differ from Part 4's examples (e.g. a new document starts at
  status `processing`, not `uploaded`; the document detail response nests
  `invoice` with per-field confidence objects).

Last reviewed: 2026-09-30.
