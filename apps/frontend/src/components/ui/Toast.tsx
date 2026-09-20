'use client';

// U-1 (audit): minimal error-toast system — mutations previously failed
// silently (console.error only). Hand-rolled to match the project's
// zero-dependency UI style; semantic tokens cover dark mode.
import { createContext, useCallback, useContext, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';

type ToastItem = { id: number; message: string };

const ToastContext = createContext<{ showError: (message: string) => void }>({
  showError: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showError = useCallback((message: string) => {
    const id = Date.now() + Math.random();
    // Keep at most 3 visible; auto-dismiss after 5s
    setToasts((prev) => [...prev.slice(-2), { id, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((t) => t.id !== id));

  return (
    <ToastContext.Provider value={{ showError }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] space-y-2 max-w-sm" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="alert"
            className="flex items-start gap-2 p-4 rounded-xl bg-card border border-red-200 dark:border-red-900 shadow-lg animate-slide-up"
          >
            <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
            <p className="text-sm text-foreground flex-1 break-words">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
