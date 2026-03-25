'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'uploaded' | 'processing' | 'parsed' | 'needs_validation' | 'validated' | 'error';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400',
    uploaded: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    processing: 'bg-yellow-50 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    parsed: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    needs_validation: 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    validated: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
    error: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  };

  return (
    <div
      className={cn('inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}
      {...props}
    />
  );
}

export { Badge };
