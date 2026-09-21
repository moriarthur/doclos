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
  amount: number | string,
  currency?: string | null,
  locale?: string,
): {
  formatted: string;
  hasCurrency: boolean;
} {
  // P2-10 (audit): pg returns numeric(12,2) as a string — parse defensively
  const value = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!isFinite(value)) {
    return { formatted: '—', hasCurrency: false };
  }
  if (currency) {
    return {
      formatted: new Intl.NumberFormat(toBcp47(locale), {
        style: 'currency',
        currency,
      }).format(value),
      hasCurrency: true,
    };
  }
  return {
    formatted: new Intl.NumberFormat(toBcp47(locale), {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value),
    hasCurrency: false,
  };
}
