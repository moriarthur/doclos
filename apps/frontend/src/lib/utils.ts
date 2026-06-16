import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format date to locale string
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Format currency
export function formatCurrency(amount: number, currency: string = 'EUR'): string {
  return new Intl.NumberFormat('de-DE', {
    style: 'currency',
    currency,
  }).format(amount);
}

// Format amount — returns number formatted and currency info
export function formatAmount(amount: number, currency?: string | null): {
  formatted: string;
  hasCurrency: boolean;
} {
  if (currency) {
    return {
      formatted: new Intl.NumberFormat('de-DE', {
        style: 'currency',
        currency,
      }).format(amount),
      hasCurrency: true,
    };
  }
  return {
    formatted: new Intl.NumberFormat('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount),
    hasCurrency: false,
  };
}

// Status badge mapping
export function getStatusBadgeClass(status: string): string {
  const statusMap: Record<string, string> = {
    uploaded: 'badge-uploaded',
    processing: 'badge-processing',
    parsed: 'badge-parsed',
    needs_validation: 'badge-needs_validation',
    validated: 'badge-validated',
    archived: 'badge-secondary',
    error: 'badge-error',
  };
  return statusMap[status] || 'badge-secondary';
}

export function getStatusLabel(status: string): string {
  const labelMap: Record<string, string> = {
    uploaded: 'Hochgeladen',
    processing: 'Verarbeitung',
    parsed: 'Verarbeitet',
    needs_validation: 'Prüfung erforderlich',
    validated: 'Validiert',
    archived: 'Archiviert',
    error: 'Fehler',
  };
  return labelMap[status] || status;
}

// Localized document type label. Returns '' for null/undefined so callers can
// gate rendering on truthiness; pass a non-empty type to get a German label.
export function getDocumentTypeLabel(type?: string | null): string {
  if (!type) return '';
  const labelMap: Record<string, string> = {
    invoice: 'Rechnung',
    contract: 'Vertrag',
    offer: 'Angebot',
    delivery_note: 'Lieferschein',
    purchase_order: 'Bestellung',
    unknown: 'Unbekannt',
  };
  return labelMap[type] ?? type;
}
