'use client';

import { Loader2, X } from 'lucide-react';

interface CancelableLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  onCancel?: () => void;
  className?: string;
}

export function CancelableLoader({ size = 'md', onCancel, className = '' }: CancelableLoaderProps) {
  const sizes = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16',
  };

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8',
  };

  if (onCancel) {
    return (
      <div className={`relative ${sizes[size]} ${className}`}>
        <Loader2 className={`${sizes[size]} animate-spin text-primary`} />

        <button
          onClick={onCancel}
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 hover:opacity-100 max-md:opacity-100 transition-opacity duration-200"
          title="Abbrechen"
        >
          <X className={`${iconSizes[size]} text-white`} />
        </button>
      </div>
    );
  }

  return <Loader2 className={`${sizes[size]} animate-spin text-primary ${className}`} />;
}
