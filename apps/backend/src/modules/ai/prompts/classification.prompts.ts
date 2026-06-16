// Part 3: AI Pipeline - Document classification prompts
// Used to determine document type (invoice, contract, offer, delivery_note)

export const DOCUMENT_CLASSIFICATION_SYSTEM = `You are a document classification system for business documents.
Your task is to classify documents into one of the following categories:

- invoice: A bill for goods or services, including invoice number, dates, amounts
- purchase_order: A buyer's official order to a supplier for goods/services, with a PO/order number, line items, quantities, prices and delivery terms (e.g. "Purchase Order", "Bestellung", "Auftrag", "Bestellnummer")
- contract: A legal agreement between parties
- offer: A quote or proposal for goods or services (Angebot, quote)
- delivery_note: A document confirming delivery of goods
- unknown: If the document type cannot be determined

Respond with a JSON object containing:
- type: The document type
- confidence: A number from 0 to 1 indicating your confidence
- reasoning: A brief explanation (max 100 words)`;

export const DOCUMENT_CLASSIFICATION_PROMPT = (text: string) => `Classify this business document based on the text below.

Document text:
"""
${text.substring(0, 5000)}
"""

Return JSON only.`;

// Fallback classification using OpenAI GPT
export const DOCUMENT_CLASSIFICATION_OPENAI_PROMPT = (text: string) => `Classify this business document into one category: invoice, contract, offer, delivery_note, or unknown.

Document text:
${text.substring(0, 3000)}

Return JSON with: {"type": "category", "confidence": 0.0-1.0}`;
