// Part 3: AI Pipeline - Structured data extraction prompts
// Used to extract invoice data from OCR text

export const INVOICE_EXTRACTION_SYSTEM = `You are a structured document extraction system for commercial documents (invoices, purchase orders, quotes/offers).
Extract the following fields from the document text:

Required fields:
- invoice_number: The document reference number — invoice number (e.g., "RE-2026-004") for invoices, or the purchase-order/order number (e.g., "PO-2026-017", "Bestellnummer") for purchase orders
- invoice_date: The invoice date in ISO format (YYYY-MM-DD)
- due_date: The payment due date in ISO format (YYYY-MM-DD), if present
- amount_total: The total amount as a number (e.g., 3200.00)
- vat_amount: The VAT/tax amount as a number (e.g., 608.00)
- currency: The ISO 4217 currency code. Use the explicitly stated currency when present (symbol like £, €, $ or code like GBP, EUR, USD, CHF). If no currency is explicitly mentioned: use "EUR" for German/EU invoices that show German indicators (€, Rechnung, MwSt/USt, German date DD.MM.YYYY or number format 1.234,56); otherwise use null. Do NOT infer currency from addresses or country codes alone.
- supplier_name: The company name issuing the invoice
- supplier_address: The supplier's address

Optional fields:
- vat_rate: The VAT percentage (e.g., 19)
- customer_name: The recipient company name
- items: Array of line items with:
  - description: Item description
  - quantity: Quantity as a number
  - unit_price: Unit price as a number
  - line_total: Line total as a number

Important notes:
- German dates: 10.03.2026 → 2026-03-10
- German amounts: 1.200,50 € → 1200.50 (use decimal point)
- If a field is not found, use null
- All numbers should be actual numbers, not strings

Return valid JSON only. No markdown formatting.`;

export const INVOICE_EXTRACTION_PROMPT = (text: string) => `Extract invoice data from the following text.

Document text:
"""
${text}
"""

Return JSON only.`;

// Simplified extraction for documents that might not be invoices
export const GENERAL_DOCUMENT_EXTRACTION_PROMPT = (text: string) => `Extract structured data from this business document.

Document text:
"""
${text}
"""

Return JSON with these fields:
- document_type: Type of document (invoice, contract, offer, delivery_note, unknown)
- date: Document date in YYYY-MM-DD format
- company_name: Main company mentioned
- amount: Any monetary amount found (as number)
- currency: Currency code
- key_fields: Object with any other important fields identified

Return JSON only.`;

// Prompt for confidence scoring
export const CONFIDENCE_ASSESSMENT_PROMPT = (extraction: unknown, text: string) => `Assess the confidence of this extraction.

Extracted data:
${JSON.stringify(extraction, null, 2)}

Original text (first 1000 chars):
${text.substring(0, 1000)}

Return JSON with:
- overall_confidence: 0-1
- field_confidence: Object mapping field names to 0-1 scores
- issues: Array of potential problems detected

Return JSON only.`;
