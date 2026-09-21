'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  FileText,
  Upload,
  LogOut,
  Menu,
  X,
  Moon,
  Sun,
  Archive,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { authApi } from '@/lib/api-client';
import { useTheme } from 'next-themes';
import { LocaleSwitcher } from './LocaleSwitcher';

const navItems = [
  { key: 'documents', href: '/', icon: FileText },
  { key: 'upload', href: '/upload', icon: Upload },
  { key: 'archive', href: '/archive', icon: Archive },
] as const;

export function Navigation() {
  const pathname = usePathname();
  const t = useTranslations('Nav');
  const tCommon = useTranslations('Common');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme, setTheme } = useTheme();
  // Avoid hydration mismatch: render the light-mode affordance until mounted,
  // then reflect the resolved theme.
  const isDark = mounted && resolvedTheme === 'dark';

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleTheme = () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');

  const handleLogout = () => {
    authApi.logout();
    window.location.href = '/login';
  };

  return (
    <>
      {/* Desktop Navigation */}
      <nav className="hidden md:flex fixed left-0 top-0 h-screen w-64 flex-col bg-card/50 backdrop-blur-sm border-r border-border p-6">
        {/* Logo */}
        <div className="mb-10">
          <h1 className="font-serif text-2xl font-bold text-primary">
            Doclos
          </h1>
          <p className="text-xs text-muted-foreground mt-1.5 tracking-wide">{tCommon('brandTagline')}</p>
        </div>

        {/* Navigation Links */}
        <div className="flex-1 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200',
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="h-5 w-5" />
                <span className="font-medium">{t(item.key)}</span>
              </Link>
            );
          })}
        </div>

        {/* Locale, Dark Mode Toggle and Logout */}
        <div className="space-y-2 pt-4 border-t border-border">
          <LocaleSwitcher />
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200 w-full"
          >
            {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            <span className="text-sm">{isDark ? t('lightMode') : t('darkMode')}</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200 w-full"
          >
            <LogOut className="h-5 w-5" />
            <span className="text-sm">{t('logout')}</span>
          </button>
        </div>
      </nav>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed top-0 left-0 right-0 bg-card/80 backdrop-blur-md border-b border-border z-50">
        <div className="flex items-center justify-between p-4">
          <h1 className="font-serif text-xl font-bold text-primary">
            Doclos
          </h1>
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileMenuOpen && (
          <div className="border-t border-border p-4 space-y-1 animate-slide-down bg-card">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={cn(
                    'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-all duration-200',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  )}
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-medium">{t(item.key)}</span>
                </Link>
              );
            })}
            <div className="divider my-3" />
            <div className="px-4 py-1">
              <LocaleSwitcher />
            </div>
            <button
              onClick={toggleTheme}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200 w-full"
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              <span className="text-sm">{isDark ? t('lightMode') : t('darkMode')}</span>
            </button>
            <button
              onClick={handleLogout}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-all duration-200 w-full"
            >
              <LogOut className="h-5 w-5" />
              <span className="text-sm">{t('logout')}</span>
            </button>
          </div>
        )}
      </nav>
    </>
  );
}
