'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { cn } from '@/lib/utils';

// Compact DE | EN toggle. Persists the choice via /api/locale (cookie) and
// refreshes so server components re-render in the new locale.
export function LocaleSwitcher() {
  const t = useTranslations('LocaleSwitcher');
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const switchTo = (next: string) => {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await fetch('/api/locale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
      router.refresh();
    });
  };

  return (
    <div className="inline-flex items-center rounded-lg border border-border overflow-hidden">
      {(['de', 'en'] as const).map((loc) => (
        <button
          key={loc}
          type="button"
          onClick={() => switchTo(loc)}
          disabled={isPending}
          aria-pressed={locale === loc}
          title={loc === 'de' ? t('german') : t('english')}
          className={cn(
            'px-2.5 py-1.5 text-xs font-medium transition-colors',
            locale === loc
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            isPending && 'opacity-50',
          )}
        >
          {loc.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
