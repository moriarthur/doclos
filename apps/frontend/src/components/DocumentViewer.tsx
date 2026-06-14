'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, FileText } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CancelableLoader } from '@/components/ui/CancelableLoader';

interface DocumentViewerProps {
  url: string;
  mimeType: string;
  error?: boolean;
  reprocessing?: boolean;
  isReprocess?: boolean;
  onCancelReprocess?: () => void;
}

export function DocumentViewer({
  url,
  mimeType,
  error: isErrorDoc = false,
  reprocessing = false,
  isReprocess = false,
  onCancelReprocess,
}: DocumentViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  useEffect(() => {
    let objectUrl: string;
    const token = localStorage.getItem('access_token');

    fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
      .then((res) => {
        if (!res.ok) throw new Error('fetch failed');
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setLoading(false);
      })
      .catch(() => {
        setFetchError(true);
        setLoading(false);
      });

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div className="aspect-[3/4] bg-muted rounded-xl flex items-center justify-center">
        <CancelableLoader size="md" />
      </div>
    );
  }

  if (fetchError || !blobUrl) {
    return (
      <div className="aspect-[3/4] bg-muted rounded-xl flex items-center justify-center">
        <div className="text-center p-8">
          <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-3">Dokument konnte nicht geladen werden</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline text-sm"
          >
            In neuem Tab öffnen
          </a>
        </div>
      </div>
    );
  }

  if (mimeType.startsWith('image/')) {
    return (
      <ImageViewer
        blobUrl={blobUrl}
        isErrorDoc={isErrorDoc}
        reprocessing={reprocessing}
        isReprocess={isReprocess}
        onCancelReprocess={onCancelReprocess}
      />
    );
  }

  return (
    <PdfViewer
      blobUrl={blobUrl}
      isErrorDoc={isErrorDoc}
      reprocessing={reprocessing}
      isReprocess={isReprocess}
      onCancelReprocess={onCancelReprocess}
    />
  );
}

/* ─── Image Viewer ─── */

function ImageViewer({
  blobUrl,
  isErrorDoc,
  reprocessing,
  isReprocess,
  onCancelReprocess,
}: {
  blobUrl: string;
  isErrorDoc: boolean;
  reprocessing: boolean;
  isReprocess: boolean;
  onCancelReprocess?: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const isBlocked = isErrorDoc || reprocessing;

  return (
    <div className="relative">
      <div
        className={`bg-muted rounded-xl overflow-auto max-h-[80vh] flex items-center justify-center p-4 ${
          isBlocked ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        <img
          src={blobUrl}
          alt="Dokument"
          className="max-w-full h-auto rounded shadow-lg transition-transform duration-200"
          style={
            !isBlocked ? { transform: `scale(${zoom})`, transformOrigin: 'top center' } : undefined
          }
        />
      </div>

      {isErrorDoc && !reprocessing && <ErrorOverlay />}
      {reprocessing && <ProcessingOverlay onCancel={onCancelReprocess} isReprocess={isReprocess} />}

      {!isBlocked && (
        <div className="absolute bottom-3 right-3 flex flex-wrap items-center justify-center gap-1 max-w-[calc(100vw-1.5rem)] bg-background/80 backdrop-blur rounded-lg p-1 shadow-md">
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-12 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            title="Zoom zurücksetzen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── PDF Viewer ─── */

function PdfViewer({
  blobUrl,
  isErrorDoc,
  reprocessing,
  isReprocess,
  onCancelReprocess,
}: {
  blobUrl: string;
  isErrorDoc: boolean;
  reprocessing: boolean;
  isReprocess: boolean;
  onCancelReprocess?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const renderingRef = useRef(false);
  const isBlocked = isErrorDoc || reprocessing;

  useEffect(() => {
    let cancelled = false;
    import('pdfjs-dist').then(async (pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.mjs`;
      try {
        const doc = await pdfjs.getDocument(blobUrl).promise;
        if (cancelled) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
      } catch {
        // handled by parent
      }
    });
    return () => {
      cancelled = true;
    };
  }, [blobUrl]);

  const renderPage = useCallback(
    async (pageNum: number) => {
      if (!pdfDoc || !canvasRef.current || !containerRef.current || renderingRef.current) return;
      renderingRef.current = true;
      try {
        const page = await pdfDoc.getPage(pageNum);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d')!;
        const containerWidth = containerRef.current.clientWidth - 32; // subtract padding
        const unscaledViewport = page.getViewport({ scale: 1 });
        // Scale so PDF fills the container width, then apply user zoom
        const fitScale = (containerWidth / unscaledViewport.width) * zoom;
        const dpr = window.devicePixelRatio || 1;
        const renderScale = fitScale * dpr;
        const viewport = page.getViewport({ scale: fitScale });
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        const renderViewport = page.getViewport({ scale: renderScale });
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
      } catch {
        // silent
      } finally {
        renderingRef.current = false;
      }
    },
    [pdfDoc, zoom]
  );

  useEffect(() => {
    if (pdfDoc) renderPage(currentPage);
  }, [pdfDoc, currentPage, renderPage]);

  // Re-render on container resize to refit
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (pdfDoc) renderPage(currentPage);
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [pdfDoc, currentPage, renderPage]);

  // Trackpad zoom (Ctrl+scroll) and pinch-to-zoom (touch)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isBlocked) return;

    const clampZoom = (z: number) => Math.min(3, Math.max(0.5, z));

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.01;
      setZoom((z) => clampZoom(z + delta));
    };

    let lastDist = 0;
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastDist = Math.hypot(dx, dy);
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      if (lastDist > 0) {
        const scale = dist / lastDist;
        setZoom((z) => clampZoom(z * scale));
      }
      lastDist = dist;
    };
    const onTouchEnd = () => {
      lastDist = 0;
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('touchstart', onTouchStart, { passive: true });
    container.addEventListener('touchmove', onTouchMove, { passive: false });
    container.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener('wheel', onWheel);
      container.removeEventListener('touchstart', onTouchStart);
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
    };
  }, [isBlocked]);

  const goTo = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`bg-muted rounded-xl overflow-auto h-[75vh] min-h-0 p-4 ${
          isBlocked ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        <canvas
          ref={canvasRef}
          className="shadow-lg rounded bg-white mx-auto"
          style={{ display: 'block' }}
        />
      </div>

      {isErrorDoc && !reprocessing && <ErrorOverlay />}
      {reprocessing && <ProcessingOverlay onCancel={onCancelReprocess} isReprocess={isReprocess} />}

      {!isBlocked && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-1 max-w-[calc(100vw-1.5rem)] bg-background/80 backdrop-blur rounded-lg p-1 shadow-md">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-2 min-w-[60px] text-center">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-4 bg-border mx-1" />
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <Button variant="ghost" size="sm" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            title="Zoom zurücksetzen"
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ─── Overlays ─── */

function ProcessingOverlay({
  onCancel,
  isReprocess,
}: {
  onCancel?: () => void;
  isReprocess?: boolean;
}) {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="text-center p-8 bg-background/70 backdrop-blur-sm rounded-2xl">
        <div className="relative inline-block">
          <CancelableLoader size="lg" onCancel={onCancel} />
        </div>
        <p className="font-medium text-foreground mb-2 mt-6">
          {isReprocess ? 'Wird neu verarbeitet...' : 'Wird verarbeitet...'}
        </p>
        <p className="text-sm text-muted-foreground">
          {onCancel ? 'Zum Abbrechen klicken' : 'Das Dokument wird analysiert.'}
        </p>
      </div>
    </div>
  );
}

function ErrorOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="text-center p-8 bg-background/70 backdrop-blur-sm rounded-2xl">
        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
        <p className="font-medium text-foreground mb-2">Fehler bei der Verarbeitung</p>
        <p className="text-sm text-muted-foreground">
          Das Dokument konnte nicht verarbeitet werden.
        </p>
      </div>
    </div>
  );
}
