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
