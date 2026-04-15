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
    md: 'h-16 w-16',
    lg: 'h-24 w-24',
  };

  const iconSizes = {
    sm: 'h-4 w-4',
    md: 'h-8 w-8',
    lg: 'h-12 w-12',
  };

  if (onCancel) {
    return (
      <div className={`relative ${sizes[size]} ${className}`}>
        {/* Spinning loader */}
        <Loader2 className={`${sizes[size]} animate-spin text-primary`} />

        {/* Cancel button - appears on hover */}
        <button
          onClick={onCancel}
          className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-full opacity-0 hover:opacity-100 transition-opacity duration-200 group"
          title="Abbrechen"
        >
          <X className={`${iconSizes[size]} text-white`} />
        </button>
      </div>
    );
  }

  return <Loader2 className={`${sizes[size]} animate-spin text-primary ${className}`} />;
}
