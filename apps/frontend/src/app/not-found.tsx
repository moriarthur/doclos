'use client';

import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Navigation } from '@/components/Navigation';

export default function NotFound() {
  const t = useTranslations('NotFound');
  return (
    <div className="flex">
      <Navigation />
      <main className="flex-1 md:ml-64 min-h-screen flex items-center justify-center">
        <div className="text-center px-6">
          <FileQuestion className="h-20 w-20 mx-auto mb-6 text-brand" />
          <h1 className="font-serif text-5xl font-bold text-brand mb-3">404</h1>
          <p className="text-lg text-muted-foreground mb-8">
            {t('desc')}
          </p>
          <Link href="/">
            <Button>{t('back')}</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
