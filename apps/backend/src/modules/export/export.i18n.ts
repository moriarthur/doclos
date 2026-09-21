import { DocumentStatus } from '../documents/entities/document.entity';

// Part 6: Excel Export System — localization
//
// Self-contained translation map for the Excel export. Locale flows in via the
// `?lang=` query param (resolved with a 'de' fallback, matching the frontend
// default). The status map is a deliberate copy of the frontend `Status`
// message namespace — there is no shared package yet (packages/shared is empty);
// revisit when S5 (document-types) lands.
//
// Number/date formats use an Excel locale prefix `[$-407]` (de-DE) so the cell
// renders in German regardless of the viewer's application locale.

export type ExportLocale = 'de' | 'en';

export interface ExportStrings {
  invoiceNumber: string;
  supplier: string;
  invoiceDate: string;
  dueDate: string;
  amountTotal: string;
  vatAmount: string;
  currency: string;
  items: string;
  status: string;
  description: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
  sheetInvoices: string;
  sheetInvoiceItems: string;
  sheetInvoice: string;
  titleInvoices: string;
  titleInvoiceItems: string;
  invoice: string; // bare word used in "Invoice {number}" title
  noLineItems: string;
  totalsItemsTotal: string;
  totalsVat: string;
  totalsAmountTotal: string;
  // --- S5.3 per-type export ---
  sheetContracts: string;
  sheetPurchaseOrders: string;
  sheetOffers: string;
  sheetDeliveryNotes: string;
  titleContracts: string;
  titlePurchaseOrders: string;
  titleOffers: string;
  titleDeliveryNotes: string;
  orderNumber: string;
  orderDate: string;
  offerNumber: string;
  offerDate: string;
  deliveryNoteNumber: string;
  deliveryDate: string;
  expectedDelivery: string;
  deliveryTerms: string;
  paymentTerms: string;
  validityDate: string;
  validityTerms: string;
  recipient: string;
  recipientAddress: string;
  orderReference: string;
  seller: string;
  buyer: string;
  contractValue: string;
  contractSubject: string;
  contractTerm: string;
  effectiveDate: string;
  endDate: string;
  contract: string; // bare word for "Contract {subject}" title
  order: string;
  offer: string;
  deliveryNote: string;
  noStructuredData: string;
}

export interface ExportI18n {
  strings: ExportStrings;
  status: Record<DocumentStatus, string>;
  numFmt: { money: string; date: string };
}

/** Resolve a raw `?lang=` value to a supported locale, 'de' fallback. */
export function resolveExportLocale(lang?: string): ExportLocale {
  return lang === 'en' ? 'en' : 'de';
}

const TRANSLATIONS: Record<ExportLocale, ExportI18n> = {
  de: {
    strings: {
      invoiceNumber: 'Rechnungsnummer',
      supplier: 'Lieferant',
      invoiceDate: 'Rechnungsdatum',
      dueDate: 'Fälligkeitsdatum',
      amountTotal: 'Gesamtbetrag',
      vatAmount: 'MwSt.-Betrag',
      currency: 'Währung',
      items: 'Positionen',
      status: 'Status',
      description: 'Beschreibung',
      quantity: 'Menge',
      unitPrice: 'Einzelpreis',
      lineTotal: 'Zeilensumme',
      sheetInvoices: 'Rechnungen',
      sheetInvoiceItems: 'Rechnungspositionen',
      sheetInvoice: 'Rechnung',
      titleInvoices: 'Doclos — Rechnungen',
      titleInvoiceItems: 'Doclos — Rechnungspositionen',
      invoice: 'Rechnung',
      noLineItems: 'Keine Positionen',
      totalsItemsTotal: 'Zwischensumme',
      totalsVat: 'MwSt.',
      totalsAmountTotal: 'Gesamtbetrag',
      sheetContracts: 'Verträge',
      sheetPurchaseOrders: 'Bestellungen',
      sheetOffers: 'Angebote',
      sheetDeliveryNotes: 'Lieferscheine',
      titleContracts: 'Doclos — Verträge',
      titlePurchaseOrders: 'Doclos — Bestellungen',
      titleOffers: 'Doclos — Angebote',
      titleDeliveryNotes: 'Doclos — Lieferscheine',
      orderNumber: 'Bestellnummer',
      orderDate: 'Bestelldatum',
      offerNumber: 'Angebotsnummer',
      offerDate: 'Angebotsdatum',
      deliveryNoteNumber: 'Lieferscheinnummer',
      deliveryDate: 'Lieferdatum',
      expectedDelivery: 'Wunschlieferdatum',
      deliveryTerms: 'Lieferbedingungen',
      paymentTerms: 'Zahlungsbedingungen',
      validityDate: 'Gültig bis',
      validityTerms: 'Gültigkeit',
      recipient: 'Empfänger',
      recipientAddress: 'Empfängeradresse',
      orderReference: 'Bestell-Referenz',
      seller: 'Verkäufer',
      buyer: 'Käufer',
      contractValue: 'Vertragswert',
      contractSubject: 'Gegenstand',
      contractTerm: 'Laufzeit',
      effectiveDate: 'Vertragsbeginn',
      endDate: 'Vertragsende',
      contract: 'Vertrag',
      order: 'Bestellung',
      offer: 'Angebot',
      deliveryNote: 'Lieferschein',
      noStructuredData: 'Keine strukturierten Daten',
    },
    status: {
      [DocumentStatus.UPLOADED]: 'Hochgeladen',
      [DocumentStatus.PROCESSING]: 'Verarbeitung',
      [DocumentStatus.PARSED]: 'Verarbeitet',
      [DocumentStatus.NEEDS_VALIDATION]: 'Prüfung erforderlich',
      [DocumentStatus.VALIDATED]: 'Validiert',
      [DocumentStatus.ARCHIVED]: 'Archiviert',
      [DocumentStatus.ERROR]: 'Fehler',
    },
    // [$-407] = de-DE locale code; forces '.' group and ',' decimal separators.
    numFmt: { money: '[$-407]#,##0.00', date: '[$-407]DD.MM.YYYY' },
  },
  en: {
    strings: {
      invoiceNumber: 'Invoice Number',
      supplier: 'Supplier',
      invoiceDate: 'Invoice Date',
      dueDate: 'Due Date',
      amountTotal: 'Amount Total',
      vatAmount: 'VAT Amount',
      currency: 'Currency',
      items: 'Items',
      status: 'Status',
      description: 'Description',
      quantity: 'Quantity',
      unitPrice: 'Unit Price',
      lineTotal: 'Line Total',
      sheetInvoices: 'Invoices',
      sheetInvoiceItems: 'Invoice_Items',
      sheetInvoice: 'Invoice',
      titleInvoices: 'Doclos — Invoices',
      titleInvoiceItems: 'Doclos — Invoice Items',
      invoice: 'Invoice',
      noLineItems: 'No line items',
      totalsItemsTotal: 'Items Total',
      totalsVat: 'VAT',
      totalsAmountTotal: 'Amount Total',
      sheetContracts: 'Contracts',
      sheetPurchaseOrders: 'Purchase Orders',
      sheetOffers: 'Offers',
      sheetDeliveryNotes: 'Delivery Notes',
      titleContracts: 'Doclos — Contracts',
      titlePurchaseOrders: 'Doclos — Purchase Orders',
      titleOffers: 'Doclos — Offers',
      titleDeliveryNotes: 'Doclos — Delivery Notes',
      orderNumber: 'Order Number',
      orderDate: 'Order Date',
      offerNumber: 'Offer Number',
      offerDate: 'Offer Date',
      deliveryNoteNumber: 'Delivery Note Number',
      deliveryDate: 'Delivery Date',
      expectedDelivery: 'Expected Delivery',
      deliveryTerms: 'Delivery Terms',
      paymentTerms: 'Payment Terms',
      validityDate: 'Valid Until',
      validityTerms: 'Validity',
      recipient: 'Recipient',
      recipientAddress: 'Recipient Address',
      orderReference: 'Order Reference',
      seller: 'Seller',
      buyer: 'Buyer',
      contractValue: 'Contract Value',
      contractSubject: 'Subject',
      contractTerm: 'Term',
      effectiveDate: 'Effective Date',
      endDate: 'End Date',
      contract: 'Contract',
      order: 'Order',
      offer: 'Offer',
      deliveryNote: 'Delivery Note',
      noStructuredData: 'No structured data',
    },
    status: {
      [DocumentStatus.UPLOADED]: 'Uploaded',
      [DocumentStatus.PROCESSING]: 'Processing',
      [DocumentStatus.PARSED]: 'Parsed',
      [DocumentStatus.NEEDS_VALIDATION]: 'Needs review',
      [DocumentStatus.VALIDATED]: 'Validated',
      [DocumentStatus.ARCHIVED]: 'Archived',
      [DocumentStatus.ERROR]: 'Error',
    },
    numFmt: { money: '#,##0.00', date: 'YYYY-MM-DD' },
  },
};

/** Look up the full i18n bundle (strings + status labels + numFmts) for a locale. */
export function getExportI18n(lang?: string): ExportI18n {
  return TRANSLATIONS[resolveExportLocale(lang)];
}
