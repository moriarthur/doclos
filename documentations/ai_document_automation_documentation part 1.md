# AI Document Automation SaaS — Master Documentation (Part 1)

This documentation is intentionally split into multiple parts so it fits within context limits

Parts:
1. Product & System Architecture
2. Data Model & AI Pipeline
3. API Specification
4. Frontend Architecture
5. Excel Export System
6. Security & Infrastructure
7. Deployment & CI/CD
8. Development System Guide
9. Persistent Memory System

This file = **Part 1: Product Vision + System Architecture**

---

# PROJECT NAME

Doclos

Repository name recommended:

`doclos`

---

# PRODUCT OVERVIEW

Doclos is a document automation SaaS designed for small businesses and the German Mittelstand.

The product automatically processes business documents such as:

Invoices (Rechnungen)
Contracts (Verträge)
Offers (Angebote)
Delivery notes (Lieferscheine)

The system extracts structured data from PDFs and stores them in a searchable database.

Users can then:

search documents
validate extracted fields
export structured reports
export Excel for accounting

---

# PROBLEM

Most SMEs process documents manually.

Typical workflow today:

1. Receive PDF via email
2. Open PDF
3. Copy values into Excel
4. Save file
5. Create accounting entry manually

This costs time and introduces errors.

Many automation tools exist but are expensive.

Examples:

Docparser
Rossum
ABBYY FlexiCapture

These solutions cost thousands per year.

Doclos aims to provide a simpler solution.

---

# TARGET USERS

Primary users:

Small companies
Construction firms
Service providers
Accounting assistants
Freelancers

Geography focus:

Germany
EU

Typical volume:

50–500 documents per month

---

# CORE FEATURES

MVP features:

Document upload (PDF)
OCR recognition
AI structured extraction
Document dashboard
PDF viewer
Manual validation
Search
Excel export

Advanced features:

Background processing
Confidence scoring
Audit logs
Reprocessing pipeline

Future features:

Accounting integrations
Automatic bookkeeping
Purchase order matching
Multi‑tenant workspaces

---

# HIGH LEVEL SYSTEM ARCHITECTURE

System consists of five main layers.

1 Frontend

User interface.

Built with:

Next.js
React
TypeScript
TailwindCSS

Responsibilities:

Dashboard
Upload UI
Document viewer
Validation UI
Search
Export

---

2 Backend API

Handles application logic.

Recommended framework:

NestJS

Alternative:

Fastify + TypeScript

Responsibilities:

Authentication
File upload
Database access
Search
Export
Queue job creation

---

3 Worker Services

Background workers process heavy tasks.

Workers handle:

OCR
LLM parsing
Report generation
Excel export

Workers communicate via queue.

---

4 Data Layer

PostgreSQL database stores structured data.

Redis used for:

job queues
caching
rate limiting

---

5 Storage Layer

Object storage stores documents.

Recommended:

AWS S3

Alternative:

Cloudflare R2

Documents stored as:

uploads/YYYY/MM/DD/file.pdf

---

# EVENT FLOW

Document upload processing pipeline:

User uploads PDF

↓

Backend stores file in S3

↓

Document record created in DB

↓

Queue job created

↓

Worker downloads PDF

↓

Text extraction / OCR

↓

LLM parsing

↓

Validation rules

↓

Save structured data

↓

Frontend updates dashboard

---

# PROCESSING STATES

Each document has a status.

States:

uploaded
processing
parsed
needs_validation
validated
archived
error

---

# DOCUMENT TIMELINE FEATURE

The UI should show processing stages.

Example timeline:

Uploaded
Processing
OCR Completed
AI Extraction
Validation
Completed

This improves transparency.

---

# QUEUE SYSTEM

Queue required for background processing.

Recommended library:

BullMQ

Queue backend:

Redis

Jobs:

process_document
run_ocr
llm_parse
generate_excel
reprocess_document

Retry strategy:

exponential backoff

Dead letter queue required.

---

# DOCUMENT TYPES

System should classify documents automatically.

Possible types:

invoice
contract
offer
delivery_note
unknown

Classification done by LLM.

---

# STORAGE STRATEGY

Files stored in object storage.

Database only stores metadata.

Document table fields:

file_name
s3_key
file_size
page_count
mime_type

This avoids storing large binaries in database.

---

# SEARCH SYSTEM

Users must be able to search by:

invoice number
company name
amount
date

Implementation:

PostgreSQL full text search

Optional upgrade later:

Elasticsearch

---

# USER INTERFACE LANGUAGES

Supported languages:

English
German

Implementation:

i18n library

Recommended:

next-i18next

---

# AUTHENTICATION

Login options:

Email + password
Google OAuth
Microsoft OAuth

JWT tokens used for session.

---

# WHY THIS PROJECT IS STRONG FOR PORTFOLIO

Demonstrates:

Full stack development
AI integration
Document processing
Background workers
Database design
Cloud architecture

It looks like a real SaaS startup project.

---

END OF PART 1

---

# PART 2 — DATA MODEL & DATABASE DESIGN

This section defines the full database schema and data structures used by the system.

Design goals:

Consistency
Traceability
Scalability
LLM provenance tracking
Human validation support

Database engine:

PostgreSQL

Why PostgreSQL:

Strong relational model
JSONB support
Full‑text search
Excellent reliability

---

# CORE ENTITIES

The system is centered around these entities:

users
customers
documents
invoices
invoice_items
jobs
audit_logs
field_extractions

---

# USERS TABLE

Represents application users.

Fields:

id (UUID, PK)
email
name
password_hash
oauth_provider
oauth_id
created_at
last_login

Example SQL:

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  password_hash TEXT,
  oauth_provider TEXT,
  oauth_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_login TIMESTAMPTZ
);
```

---

# CUSTOMERS TABLE

Stores companies extracted from documents.

Fields:

id
name
tax_id
vat_id
address
city
country
created_at

Example:

```sql
CREATE TABLE customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  tax_id TEXT,
  vat_id TEXT,
  address TEXT,
  city TEXT,
  country TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

# DOCUMENTS TABLE

Represents uploaded files.

Fields:

id
user_id
customer_id
type
status
original_filename
s3_key
mime_type
file_size
page_count
created_at
processed_at

Example SQL:

```sql
CREATE TABLE documents (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  customer_id UUID REFERENCES customers(id),
  type TEXT,
  status TEXT,
  original_filename TEXT,
  s3_key TEXT,
  mime_type TEXT,
  file_size INTEGER,
  page_count INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ
);
```

---

# INVOICES TABLE

Stores structured invoice data extracted from documents.

Fields:

id
document_id
invoice_number
invoice_date
due_date
amount_total
vat_amount
currency
supplier_name
supplier_address
validated
created_at

Example SQL:

```sql
CREATE TABLE invoices (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  invoice_number TEXT,
  invoice_date DATE,
  due_date DATE,
  amount_total NUMERIC(12,2),
  vat_amount NUMERIC(12,2),
  currency TEXT,
  supplier_name TEXT,
  supplier_address TEXT,
  validated BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

# INVOICE ITEMS TABLE

Each invoice can contain multiple line items.

Fields:

id
invoice_id
description
quantity
unit_price
line_total

Example SQL:

```sql
CREATE TABLE invoice_items (
  id UUID PRIMARY KEY,
  invoice_id UUID REFERENCES invoices(id),
  description TEXT,
  quantity NUMERIC(10,2),
  unit_price NUMERIC(10,2),
  line_total NUMERIC(10,2)
);
```

---

# FIELD_EXTRACTIONS TABLE

This table stores the raw extraction results from OCR/LLM for each field.

Purpose:

Track confidence
Track source
Allow debugging
Enable human validation

Fields:

id
document_id
field_name
value
confidence
source
snippet
created_at

Example SQL:

```sql
CREATE TABLE field_extractions (
  id UUID PRIMARY KEY,
  document_id UUID REFERENCES documents(id),
  field_name TEXT,
  value TEXT,
  confidence NUMERIC(3,2),
  source TEXT,
  snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

Example row:

field_name: invoice_number
value: RE‑2026‑004
confidence: 0.94
source: llm
snippet: "Rechnung Nr. RE‑2026‑004"

---

# JOBS TABLE

Tracks background jobs.

Fields:

id
job_type
status
document_id
attempts
last_error
created_at
updated_at

Example SQL:

```sql
CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  job_type TEXT,
  status TEXT,
  document_id UUID REFERENCES documents(id),
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ
);
```

---

# AUDIT LOGS TABLE

Tracks all changes to extracted data.

Fields:

id
entity_type
entity_id
user_id
action
old_value
new_value
created_at

Example SQL:

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY,
  entity_type TEXT,
  entity_id UUID,
  user_id UUID REFERENCES users(id),
  action TEXT,
  old_value JSONB,
  new_value JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

# RELATIONSHIP DIAGRAM (LOGICAL)

users
  │
  └── documents
        │
        └── invoices
              │
              └── invoice_items

customers
  │
  └── documents

---

# INDEX STRATEGY

Indexes required for fast queries.

Examples:

```sql
CREATE INDEX idx_documents_user
ON documents(user_id);

CREATE INDEX idx_invoices_number
ON invoices(invoice_number);

CREATE INDEX idx_invoices_date
ON invoices(invoice_date);

CREATE INDEX idx_customers_name
ON customers(name);
```

Full text search index:

```sql
CREATE INDEX idx_customer_search
ON customers
USING GIN (to_tsvector('english', name));
```

---

# DATA VALIDATION RULES

Invoice number must not be empty.

Invoice date must be valid ISO date.

Total amount must be >= 0.

VAT must be between 0 and 100.

Sum of invoice_items should approximately equal total amount.

Tolerance allowed: 0.5%.

---

# CONFIDENCE SYSTEM

Each extracted field includes a confidence score.

Range:

0.0 – 1.0

Interpretation:

>0.85 auto accepted

0.6–0.85 requires validation

<0.6 flagged as low confidence

Confidence is calculated using:

OCR token probability
LLM extraction reliability
Pattern validation

---

# HUMAN VALIDATION WORKFLOW

If confidence is low:

Document status becomes:

needs_validation

User interface shows:

PDF viewer
Editable fields
Confidence indicators

User edits values and confirms.

System writes audit log.

---

END OF PART 2

Next section will define:

AI Pipeline
OCR architecture
LLM prompt templates
Document classification system
Processing orchestration

