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
- items: Array of real line items from the item table only. Each item must be a genuine priced row:
  - description: Item description
  - quantity: Quantity as a number
  - unit_price: Unit price as a number
  - line_total: Line total as a number

  Rules for items (CRITICAL — over-extraction is the failure mode):
  - A line item MUST carry at least a quantity OR a unit_price OR a line_total. If a row has no
    number at all, it is NOT a line item — skip it. If the document has no priced rows, return "items": [].
  - Never emit summary/totals rows as items. Exclude any row whose description is or begins with:
    Zwischensumme, Subtotal, Summe, Gesamtsumme, Endsumme, Gesamtbetrag, Endbetrag, Rechnungsbetrag,
    Mehrwertsteuer, MwSt, USt, Umsatzsteuer, VAT, Tax, Versandkosten, Versand, Porto, Shipping,
    Rabatt, Skonto, Discount, Gutschrift, Zahlbetrag, Zahlungsbetrag, Total, Netto, Brutto.
  - Never emit the table header row (e.g. Pos/Position/Beschreibung/Menge/Anzahl/Einheit/Einzelpreis/
    Gesamtpreis/Preis/Betrag/Description/Qty/Quantity/Unit/Price/Total/Amount).
  - Never invent an item from footer notes, payment terms, bank details, or small print that has no
    price/quantity on its own row.
  - Emit exactly one object per real row; never fold totals into a fake item and never split one row.

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

// --- S5.1 per-type extraction prompts -------------------------------------
// The invoice prompt above is byte-identical and stays the invoice path. The
// prompts below carry the SAME discipline (German date/number rules, valid-JSON,
// null-when-not-found, items over-extraction rules) to the other commercial
// types, plus a contract prompt that has no items array. Field names match the
// per-type interfaces in structured-extraction.service.ts.

export const PURCHASE_ORDER_EXTRACTION_SYSTEM = `You are a structured document extraction system for PURCHASE ORDERS (Bestellungen).
Extract the following fields from the document text:

Required fields:
- po_number: The purchase-order / order reference number (e.g., "PO-2026-017", "Bestellnummer B-1234")
- order_date: The order/issue date in ISO format (YYYY-MM-DD)
- amount_total: The total amount as a number (e.g., 3200.00)
- vat_amount: The VAT/tax amount as a number (e.g., 608.00)
- currency: The ISO 4217 currency code. Use the explicitly stated currency when present (symbol like £, €, $ or code like GBP, EUR, USD, CHF). If no currency is explicitly mentioned: use "EUR" for German/EU purchase orders that show German indicators (€, Bestellung, MwSt/USt, German date DD.MM.YYYY or number format 1.234,56); otherwise use null. Do NOT infer currency from addresses or country codes alone.
- supplier_name: The VENDOR being ordered from (the company that will fulfil the order)
- supplier_address: The vendor's address

Optional fields:
- customer_name: The BUYER placing the order (usually us)
- expected_delivery_date: Requested/expected delivery date in ISO format (YYYY-MM-DD)
- delivery_terms: Delivery terms (e.g., "EXW Frankfurt", "DAP", "frei Haus")
- payment_terms: Payment terms (e.g., "Zahlbar innerhalb 14 Tagen", "30 Tage netto")
- items: Array of real line items from the item table only. Each item must be a genuine priced row:
  - description: Item description
  - quantity: Quantity as a number
  - unit_price: Unit price as a number
  - line_total: Line total as a number

  Rules for items (CRITICAL — over-extraction is the failure mode):
  - A line item MUST carry at least a quantity OR a unit_price OR a line_total. If a row has no
    number at all, it is NOT a line item — skip it. If the document has no priced rows, return "items": [].
  - Never emit summary/totals rows as items. Exclude any row whose description is or begins with:
    Zwischensumme, Subtotal, Summe, Gesamtsumme, Endsumme, Gesamtbetrag, Endbetrag, Rechnungsbetrag,
    Mehrwertsteuer, MwSt, USt, Umsatzsteuer, VAT, Tax, Versandkosten, Versand, Porto, Shipping,
    Rabatt, Skonto, Discount, Gutschrift, Zahlbetrag, Zahlungsbetrag, Total, Netto, Brutto.
  - Never emit the table header row (e.g. Pos/Position/Beschreibung/Menge/Anzahl/Einheit/Einzelpreis/
    Gesamtpreis/Preis/Betrag/Description/Qty/Quantity/Unit/Price/Total/Amount).
  - Never invent an item from footer notes, payment terms, bank details, or small print that has no
    price/quantity on its own row.
  - Emit exactly one object per real row; never fold totals into a fake item and never split one row.

Important notes:
- German dates: 10.03.2026 → 2026-03-10
- German amounts: 1.200,50 € → 1200.50 (use decimal point)
- If a field is not found, use null
- All numbers should be actual numbers, not strings

Return valid JSON only. No markdown formatting.`;

export const PURCHASE_ORDER_EXTRACTION_PROMPT = (text: string) => `Extract purchase-order data from the following text.

Document text:
"""
${text}
"""

Return JSON only.`;

export const OFFER_EXTRACTION_SYSTEM = `You are a structured document extraction system for OFFERS / QUOTES (Angebote).
Extract the following fields from the document text:

Required fields:
- offer_number: The offer/quote reference number (e.g., "AN-2026-031", "Angebot Nr. 42")
- offer_date: The offer/issue date in ISO format (YYYY-MM-DD)
- amount_total: The total amount as a number (e.g., 3200.00)
- vat_amount: The VAT/tax amount as a number (e.g., 608.00)
- currency: The ISO 4217 currency code. Use the explicitly stated currency when present (symbol like £, €, $ or code like GBP, EUR, USD, CHF). If no currency is explicitly mentioned: use "EUR" for German/EU offers that show German indicators (€, Angebot, MwSt/USt, German date DD.MM.YYYY or number format 1.234,56); otherwise use null. Do NOT infer currency from addresses or country codes alone.
- supplier_name: The company issuing the offer (the potential supplier)
- supplier_address: The supplier's address

Optional fields:
- customer_name: The prospect the offer is addressed to
- validity_date: The offer's "valid until" date in ISO format (YYYY-MM-DD)
- validity_terms: Validity terms text (e.g., "Angebot gültig 30 Tage", "binding for 4 weeks")
- items: Array of real line items from the item table only. Each item must be a genuine priced row:
  - description: Item description
  - quantity: Quantity as a number
  - unit_price: Unit price as a number
  - line_total: Line total as a number

  Rules for items (CRITICAL — over-extraction is the failure mode):
  - A line item MUST carry at least a quantity OR a unit_price OR a line_total. If a row has no
    number at all, it is NOT a line item — skip it. If the document has no priced rows, return "items": [].
  - Never emit summary/totals rows as items. Exclude any row whose description is or begins with:
    Zwischensumme, Subtotal, Summe, Gesamtsumme, Endsumme, Gesamtbetrag, Endbetrag, Rechnungsbetrag,
    Mehrwertsteuer, MwSt, USt, Umsatzsteuer, VAT, Tax, Versandkosten, Versand, Porto, Shipping,
    Rabatt, Skonto, Discount, Gutschrift, Zahlbetrag, Zahlungsbetrag, Total, Netto, Brutto.
  - Never emit the table header row (e.g. Pos/Position/Beschreibung/Menge/Anzahl/Einheit/Einzelpreis/
    Gesamtpreis/Preis/Betrag/Description/Qty/Quantity/Unit/Price/Total/Amount).
  - Never invent an item from footer notes, payment terms, bank details, or small print that has no
    price/quantity on its own row.
  - Emit exactly one object per real row; never fold totals into a fake item and never split one row.

Important notes:
- German dates: 10.03.2026 → 2026-03-10
- German amounts: 1.200,50 € → 1200.50 (use decimal point)
- If a field is not found, use null
- All numbers should be actual numbers, not strings

Return valid JSON only. No markdown formatting.`;

export const OFFER_EXTRACTION_PROMPT = (text: string) => `Extract offer/quote data from the following text.

Document text:
"""
${text}
"""

Return JSON only.`;

export const DELIVERY_NOTE_EXTRACTION_SYSTEM = `You are a structured document extraction system for DELIVERY NOTES (Lieferschein / Warenbegleitschein).
Delivery notes list delivered goods (usually with quantities, often WITHOUT prices). Extract the following fields:

Required fields:
- delivery_note_number: The delivery note number (e.g., "LS-2026-008", "Lieferschein Nr. 12")
- delivery_date: The delivery date in ISO format (YYYY-MM-DD)
- supplier_name: The SENDER / company shipping the goods
- supplier_address: The sender's address

Optional fields:
- amount_total: Total amount as a number — usually ABSENT on delivery notes; return null unless an explicit total is printed.
- vat_amount: VAT amount as a number — usually ABSENT; return null unless explicitly printed.
- currency: ISO 4217 currency code — usually ABSENT (no prices); return null unless prices are actually shown.
- recipient_name: The RECIPIENT / company receiving the goods
- recipient_address: The recipient's address
- order_reference: Referenced purchase-order / order number (e.g., "Bestell-Nr. B-1234")
- items: Array of real line items from the item table only. Delivery-note items usually carry a
  quantity but NO price — that is expected and valid. Each item:
  - description: Item description
  - quantity: Quantity as a number
  - unit_price: Unit price as a number — usually null on delivery notes; do NOT invent one.
  - line_total: Line total as a number — usually null on delivery notes; do NOT invent one.

  Rules for items (CRITICAL — over-extraction is the failure mode):
  - A line item MUST carry a quantity (a price is NOT required on a delivery note). If a row has
    neither a quantity NOR a price, it is NOT a line item — skip it. If the document has no rows,
    return "items": [].
  - Never emit summary/totals rows as items. Exclude any row whose description is or begins with:
    Zwischensumme, Subtotal, Summe, Gesamtsumme, Endsumme, Gesamtbetrag, Endbetrag, Rechnungsbetrag,
    Mehrwertsteuer, MwSt, USt, Umsatzsteuer, VAT, Tax, Versandkosten, Versand, Porto, Shipping,
    Rabatt, Skonto, Discount, Gutschrift, Zahlbetrag, Zahlungsbetrag, Total, Netto, Brutto.
  - Never emit the table header row (e.g. Pos/Position/Beschreibung/Menge/Anzahl/Einheit/Einzelpreis/
    Gesamtpreis/Preis/Betrag/Description/Qty/Quantity/Unit/Price/Total/Amount).
  - Never invent an item from footer notes, signature blocks, or small print that has no quantity on its own row.
  - Emit exactly one object per real row; never fold totals into a fake item and never split one row.

Important notes:
- German dates: 10.03.2026 → 2026-03-10
- German amounts: 1.200,50 € → 1200.50 (use decimal point)
- If a field is not found, use null
- All numbers should be actual numbers, not strings

Return valid JSON only. No markdown formatting.`;

export const DELIVERY_NOTE_EXTRACTION_PROMPT = (text: string) => `Extract delivery-note data from the following text.

Document text:
"""
${text}
"""

Return JSON only.`;

export const CONTRACT_EXTRACTION_SYSTEM = `You are a structured document extraction system for CONTRACTS / AGREEMENTS (Verträge).
Contracts are non-tabular: prioritize the contracting parties and dates over everything else. There is NO items array.

Extract the following fields:
- seller_name: The company/party PROVIDING the service or goods under the contract (often labelled Auftraggeber, Lieferant, Dienstleister, Provider, Seller)
- buyer_name: The company/party RECEIVING the service or goods (often labelled Auftraggeber/Auftragnehmer depending on phrasing — pick the party paying for, or receiving, the service; Kunde, Besteller, Buyer, Client)
- effective_date: The contract start / signature date in ISO format (YYYY-MM-DD)
- end_date: The contract end / termination date in ISO format (YYYY-MM-DD), if stated
- contract_value: The total contract value as a number (e.g., 24000.00), if stated
- currency: ISO 4217 currency code for contract_value when explicitly stated (EUR/USD/CHF/...). If none is stated but German indicators are present (€, Vertrag, MwSt, DD.MM.YYYY), use "EUR"; otherwise null.
- subject: A short phrase describing what the contract is for (e.g., "Wartung IT-Infrastruktur", "delivery of 10 laptops")
- term_description: The contract term / duration in plain text (e.g., "12 Monate", "unbefristet", "1 year, auto-renewing")

Important notes:
- German dates: 10.03.2026 → 2026-03-10
- German amounts: 1.200,50 € → 1200.50 (use decimal point)
- Parties: capture the legal company names, not personal names where a company is the contracting party.
- If a field is not found, use null. Do NOT invent parties or dates.
- All numbers should be actual numbers, not strings.
- Do NOT return an "items" array — contracts have none.

Return valid JSON only. No markdown formatting.`;

export const CONTRACT_EXTRACTION_PROMPT = (text: string) => `Extract contract data from the following text.

Document text:
"""
${text}
"""

Return JSON only.`;

// Prompt for confidence scoring.
// `issues` are returned BILINGUAL (German + English) so the validation card can
// render in whichever UI locale the user has selected, regardless of when the
// document was processed. Each issue is one short, concrete sentence per language.
export const CONFIDENCE_ASSESSMENT_PROMPT = (extraction: unknown, text: string) => `Assess the confidence of this extraction.

Extracted data:
${JSON.stringify(extraction, null, 2)}

Original text (first 1000 chars):
${text.substring(0, 1000)}

Return JSON with:
- overall_confidence: 0-1
- field_confidence: Object mapping field names to 0-1 scores
- issues: Array of potential problems detected. Each item MUST be an object
  { "de": "<German sentence>", "en": "<English sentence>" } where both describe
  the SAME concern. Keep each sentence short and concrete (e.g. an unmatched
  number, a missing address, an anomaly). Empty array if nothing is wrong.

Return JSON only.`;
