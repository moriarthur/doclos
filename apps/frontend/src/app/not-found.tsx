'use client';

import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Navigation } from '@/components/Navigation';

export default function NotFound() {
  return (
    <div className="flex">
      <Navigation />
      <main className="flex-1 md:ml-64 min-h-screen flex items-center justify-center">
        <div className="text-center px-6">
          <FileQuestion className="h-20 w-20 mx-auto mb-6 text-muted-foreground" />
          <h1 className="font-serif text-5xl font-bold text-brand mb-3">404</h1>
          <p className="text-lg text-muted-foreground mb-8">
            Diese Seite wurde nicht gefunden.
          </p>
          <Link href="/">
            <Button>Zurück zur Übersicht</Button>
          </Link>
        </div>
      </main>
    </div>
  );
}
