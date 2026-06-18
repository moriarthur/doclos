# PART 3 — AI PROCESSING PIPELINE

This document defines the full AI processing pipeline used by the Doclos system.

Focus areas:

• OCR processing
• handwritten text handling
• document classification
• LLM structured extraction
• confidence scoring
• validation workflows
• cost‑efficient orchestration

This pipeline is designed for **production‑grade SaaS systems** where documents arrive in unpredictable formats.

---

# PIPELINE OVERVIEW

Every uploaded document moves through the following stages:

1. Upload
2. Queue dispatch
3. Document structure analysis
4. OCR (if required)
5. Text normalization
6. Document classification
7. LLM structured extraction
8. Post‑processing validation
9. Confidence scoring
10. Human validation (if required)
11. Database persistence

The pipeline runs asynchronously using background workers.

---

# STEP 1 — DOCUMENT UPLOAD

User uploads a document through the frontend.

Supported formats:

PDF
PNG
JPG
TIFF

Typical scenario:

User uploads invoice PDF.

Backend actions:

1. Save file to object storage (S3 / R2)
2. Create DB record
3. Set status = "uploaded"
4. Create queue job

Queue job type:

process_document

---

# STEP 2 — JOB DISPATCH

Queue system distributes work to processing workers.

Recommended queue system:

BullMQ

Queue backend:

Redis

Worker responsibilities:

• download file
• detect format
• trigger OCR
• call LLM extraction

Retry strategy:

Exponential backoff

Max attempts:

5

Dead‑letter queue required.

---

# STEP 3 — DOCUMENT STRUCTURE ANALYSIS

Before extraction, the system determines document type and layout.

Tools used:

pdfinfo
pdf-parse
pdfjs

The worker evaluates:

• number of pages
• embedded text presence
• image density
• layout complexity

Possible document categories:

text_pdf
scanned_pdf
mixed_pdf
image_document

---

# STEP 4 — TEXT EXTRACTION

## Case 1 — Text PDF

Text already exists in document.

Extraction libraries:

pdf-parse
pdfjs

Result:

raw_text

This path is fastest and most accurate.

Processing time:

< 1 second typical.

---

## Case 2 — Scanned PDF

> **STATUS (as built): NOT IMPLEMENTED.** "PDF to image conversion not yet implemented" — scanned/mixed PDFs currently error out instead of being OCR'd.

Document contains images only.

OCR pipeline required.

Pipeline:

PDF
→ page images
→ preprocessing
→ OCR
→ merged text

Libraries:

Poppler
Tesseract
OpenCV

---

## Case 3 — Mixed PDF

Some pages contain text.
Some pages contain images.

Strategy:

Extract embedded text
OCR image blocks
Merge results

---

# OCR ARCHITECTURE

Primary OCR engine:

Tesseract

Languages installed:

German (deu)
English (eng)

Reason:

Most invoices in Germany contain both languages.

---

# IMAGE PREPROCESSING

> **STATUS (as built): aspirational.** The OpenCV pipeline below is not implemented; OCR runs via Tesseract.js directly.

OCR accuracy depends heavily on preprocessing.

Pipeline includes:

1. grayscale conversion
2. adaptive thresholding
3. noise reduction
4. skew correction
5. contrast enhancement

Libraries:

OpenCV

Example pipeline:

Image
→ grayscale
→ binarization
→ deskew
→ OCR

---

# HANDWRITTEN TEXT STRATEGY

> **STATUS (as built): NOT IMPLEMENTED / aspirational.** Only Tesseract.js OCR (deu+eng) is wired up; there is no cloud-OCR fallback (Google Vision / AWS Textract) and no OpenCV preprocessing. Scanned/handwritten documents fall through to the not-yet-implemented PDF→image path.

Handwritten text is difficult for traditional OCR.

Fallback strategy (planned, not built):

Cloud‑based OCR.

Recommended services:

Google Vision API
AWS Textract

Activation rule:

If OCR confidence < 0.70

Send page to cloud OCR.

Merge results.

This approach balances:

cost
accuracy
speed

---

# TEXT NORMALIZATION

Raw OCR output is noisy.

Normalization tasks include:

• remove duplicate whitespace
• normalize numbers
• normalize currencies
• normalize dates
• remove artifacts

Examples:

"1.200,50 €" → "1200.50 EUR"

"10.03.2026" → "2026-03-10"

Normalization dramatically improves LLM extraction quality.

---

# DOCUMENT CLASSIFICATION

Before field extraction, the document must be classified.

Possible document types:

invoice
contract
offer
delivery_note
unknown

Classification is performed by an LLM.

Example prompt:

Classify this business document into one category:

invoice
contract
offer
delivery_note
unknown

Return JSON only.

Example output:

{
  "type": "invoice",
  "confidence": 0.91
}

---

# LLM STRUCTURED EXTRACTION

After classification the document text is sent to an LLM for structured parsing.

> **STATUS (as built):** the production model is **GLM-4.7-Flash** (Zhipu AI / Z.ai, `open.bigmodel.cn`) — not Claude or OpenAI GPT. The original "Primary: Claude / Fallback: OpenAI" wording below was speculative and is superseded by `apps/backend/src/modules/ai/`.

Primary model:

GLM-4.7-Flash (Z.ai)

Reasons:

Free / very low cost, strong structured-JSON extraction on invoices.

---

# EXTRACTION PROMPT

System prompt:

You are a structured document extraction system.
Extract invoice data from the text and return strict JSON.

Required fields:

invoice_number
invoice_date
company_name
currency
amount_total
vat_amount
due_date
address
items

Each field must contain:

value
confidence

If value missing return null.

---

# LINE ITEM EXTRACTION

Invoices often contain tabular line items.

LLM extracts them into arrays.

Example:

{
 "items": [
  {
   "description": "Construction materials",
   "quantity": 1,
   "unit_price": 3200,
   "line_total": 3200
  }
 ]
}

---

# POST‑PROCESSING VALIDATION

After extraction the backend validates values.

Rules:

invoice_number must exist
amount_total >= 0
vat between 0 and 100

Cross‑check:

sum(items) ≈ amount_total

Tolerance:

0.5%

---

# CONFIDENCE SCORING

Each extracted field receives a confidence score.

Range:

0.0 – 1.0

Confidence calculated from:

OCR token probability
LLM extraction confidence
pattern validation

Example:

{
 "field": "invoice_number",
 "value": "RE‑2026‑004",
 "confidence": 0.94
}

---

# CONFIDENCE THRESHOLDS

> 0.85

Automatically accepted.

0.60 – 0.85

Requires manual validation.

< 0.60

Marked as low confidence.

---

# HUMAN VALIDATION WORKFLOW

If confidence is low:

Document status becomes:

needs_validation

Frontend shows:

PDF viewer
Editable extracted fields
Confidence indicators

User edits values and confirms.

System stores:

final value
audit log
confidence override

---

# PIPELINE PERFORMANCE TARGETS

Text PDF:

Processing time: 3–5 seconds.

Scanned document:

Processing time: 10–20 seconds.

Large document (20+ pages):

Processing time: up to 60 seconds.

All processing is asynchronous.

---

# COST OPTIMIZATION STRATEGY

To control AI costs:

1. OCR first
2. Send only relevant text to LLM
3. Cache processed documents
4. Use fallback models only if needed

---

# FUTURE IMPROVEMENTS

Advanced table detection
Layout‑aware extraction
Fine‑tuned models
Invoice template learning

---

END OF PART 3

Next file:

PART 4 — API SPECIFICATION

