import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Map a next-intl locale ('de' | 'en') to a BCP47 tag for Intl APIs.
export function toBcp47(locale?: string): string {
  return locale === 'en' ? 'en-US' : 'de-DE';
}

// Format date to locale string
export function formatDate(date: string | Date, locale?: string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(toBcp47(locale), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

// Format currency
export function formatCurrency(amount: number, currency: string = 'EUR', locale?: string): string {
  return new Intl.NumberFormat(toBcp47(locale), {
    style: 'currency',
    currency,
  }).format(amount);
}

// Format amount — returns number formatted and currency info
export function formatAmount(
  amount: number,
  currency?: string | null,
  locale?: string,
): {
  formatted: string;
  hasCurrency: boolean;
} {
  if (currency) {
    return {
      formatted: new Intl.NumberFormat(toBcp47(locale), {
        style: 'currency',
        currency,
      }).format(amount),
      hasCurrency: true,
    };
  }
  return {
    formatted: new Intl.NumberFormat(toBcp47(locale), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount),
    hasCurrency: false,
  };
}

// Status badge CSS class mapping (visual only — labels come from i18n)
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
