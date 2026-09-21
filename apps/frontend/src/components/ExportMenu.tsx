'use client';

import { useState, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Download, ChevronDown, Loader2, Lock } from 'lucide-react';
import { exportApi } from '@/lib/api-client';
import { Button } from '@/components/ui/Button';

// Format picker → download trigger. Excel is implemented today; CSV/JSON are
// listed but disabled ("coming soon") so the UI is ready when the backend
// generators land. Works for both the dashboard list export and the
// single-document detail export from Document Details.

type FormatId = 'excel' | 'csv' | 'json';
const FORMATS: { id: FormatId; available: boolean }[] = [
  { id: 'excel', available: true },
  { id: 'csv', available: false },
  { id: 'json', available: false },
];

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// The backend returns JSON for 4xx/5xx even when responseType is 'blob'; pull
// the message out of the error blob, falling back to a generic string.
async function blobErrorMessage(blob: Blob, fallback: string): Promise<string> {
  if (blob.type?.includes('application/json')) {
    try {
      const data = JSON.parse(await blob.text());
      return data.message || fallback;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

export function ExportMenu({
  variant,
  status,
  documentId,
  ids,
  disabled,
}: {
  variant: 'list' | 'detail';
  status?: string;
  documentId?: string;
  /** When provided (list export), only the selected documents are exported. */
  ids?: string[];
  /** Disable the whole menu (e.g. detail export for a doc with no invoice data). */
  disabled?: boolean;
}) {
  const t = useTranslations('Export');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // 'left'  → anchor to the button's left edge, menu extends right (text L→R);
  // 'right' → anchor to the button's right edge, menu extends left.
  // Chosen per-open by available viewport space so the menu never opens
  // off-screen or slides under the sidebar on narrow/wrapped layouts.
  const [align, setAlign] = useState<'left' | 'right'>('right');
  const ref = useRef<HTMLDivElement>(null);

  // w-48 = 12rem = 192px. Prefers extending right (left-aligned) so on mobile
  // and when the button sits near the sidebar the text reads left-to-right.
  const computeAlign = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const spaceRight = window.innerWidth - r.left;
    const spaceLeft = r.right;
    setAlign(spaceRight >= 192 || spaceRight >= spaceLeft ? 'left' : 'right');
  };

  const toggle = () => {
    if (!open) computeAlign();
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onResize = () => computeAlign();
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const handleExport = async (formatId: FormatId) => {
    setErrMsg(null);
    setBusy(true);
    try {
      const isSelected = variant === 'list' && !!ids && ids.length > 0;
      const filename =
        variant === 'detail'
          ? `doclos-invoice-${documentId}.xlsx`
          : isSelected
            ? 'doclos-invoices-selected.xlsx'
            : 'doclos-invoices.xlsx';
      const blob =
        variant === 'detail'
          ? await exportApi.detail(documentId!, formatId)
          : await exportApi.list({ format: formatId, status, ids });
      triggerDownload(blob, filename);
      setOpen(false);
    } catch (err: any) {
      const blob = err?.response?.data;
      setErrMsg(blob instanceof Blob ? await blobErrorMessage(blob, t('error')) : t('error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        variant="secondary"
        size="sm"
        className="gap-1.5"
        onClick={toggle}
        disabled={busy || disabled}
        title={disabled ? t('noInvoiceData') : t('button')}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        {t('button')}
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>

      {open && (
        <div className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} mt-2 w-48 rounded-lg border border-border bg-background shadow-lg z-20 overflow-hidden`}>
          {FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              disabled={!f.available || busy}
              onClick={() => handleExport(f.id)}
              className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors ${
                f.available
                  ? 'text-foreground hover:bg-muted cursor-pointer'
                  : 'text-muted-foreground/70 bg-muted/40 cursor-not-allowed'
              }`}
            >
              <span className="flex items-center gap-2">
                {!f.available && <Lock className="h-3 w-3" />}
                {t(f.id)}
              </span>
              {!f.available && (
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {t('soon')}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {errMsg && (
        <p className={`absolute ${align === 'left' ? 'left-0' : 'right-0'} top-full mt-2 text-xs text-red-600 dark:text-red-400 whitespace-nowrap`}>
          {errMsg}
        </p>
      )}
    </div>
  );
}
