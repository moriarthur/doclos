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
