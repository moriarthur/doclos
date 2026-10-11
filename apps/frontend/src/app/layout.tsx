import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/lib/react-query-provider';
import { ThemeProvider } from '@/lib/theme-provider';
import { ToastProvider } from '@/components/ui/Toast';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';

export const metadata: Metadata = {
  title: 'Doclos - AI Document Automation',
  description: 'Automate invoice processing with AI-powered extraction and validation',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <QueryProvider>
              <ToastProvider>
                <div className="min-h-screen bg-background">
                  {children}
                </div>
              </ToastProvider>
            </QueryProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
