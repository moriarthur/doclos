'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  TransformWrapper,
  TransformComponent,
  type ReactZoomPanPinchRef,
} from 'react-zoom-pan-pinch';
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
  const t = useTranslations('DocumentViewer');
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
          <p className="text-sm text-muted-foreground mb-3">{t('loadFailed')}</p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline text-sm"
          >
            {t('openNewTab')}
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

/* ─── Shared zoom/pan controls config ─── */
const VIEWER_TRANSFORM_PROPS = {
  minScale: 0.5,
  maxScale: 6,
  centerOnInit: true,
  limitToBounds: true,
  doubleClick: { mode: 'toggle' as const, step: 0.7 },
};

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
  const t = useTranslations('DocumentViewer');
  const [scale, setScale] = useState(1);
  const instanceRef = useRef<ReactZoomPanPinchRef | null>(null);
  const isBlocked = isErrorDoc || reprocessing;

  return (
    <div className="relative">
      <div
        className={`bg-muted rounded-xl overflow-hidden h-[60vh] md:h-[80vh] flex items-center justify-center p-4 ${
          isBlocked ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        <TransformWrapper
          ref={instanceRef}
          {...VIEWER_TRANSFORM_PROPS}
          disabled={isBlocked}
          onTransform={(_ref, state) => setScale(state.scale)}
        >
          <TransformComponent wrapperClass="!cursor-grab active:!cursor-grabbing">
            <img
              src={blobUrl}
              alt={t('docAlt')}
              className="max-w-full h-auto rounded shadow-lg"
              draggable={false}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {isErrorDoc && !reprocessing && <ErrorOverlay />}
      {reprocessing && (
        <ProcessingOverlay onCancel={onCancelReprocess} isReprocess={isReprocess} />
      )}

      {!isBlocked && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-0.5 max-w-[calc(100vw-1.5rem)] bg-background/80 backdrop-blur rounded-lg p-0.5 shadow-md">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.zoomOut(0.4)}
            title={t('zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-9 text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.zoomIn(0.4)}
            title={t('zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.resetTransform()}
            disabled={scale === 1}
            title={t('zoomReset')}
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
  const t = useTranslations('DocumentViewer');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<ReactZoomPanPinchRef | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1);
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

  // Render the page fit-to-width, crisp via devicePixelRatio. Zoom is handled
  // by TransformWrapper (CSS transform), so the canvas only re-renders on
  // page change / container resize — no per-zoom re-render needed.
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
        const fitScale = containerWidth / unscaledViewport.width;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: fitScale });
        const renderViewport = page.getViewport({ scale: fitScale * dpr });
        canvas.width = Math.round(viewport.width * dpr);
        canvas.height = Math.round(viewport.height * dpr);
        canvas.style.width = `${Math.round(viewport.width)}px`;
        canvas.style.height = `${Math.round(viewport.height)}px`;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
      } catch {
        // silent
      } finally {
        renderingRef.current = false;
      }
    },
    [pdfDoc]
  );

  // Render current page (fit-to-width) and reset pan/zoom to the new page.
  useEffect(() => {
    if (!pdfDoc) return;
    renderPage(currentPage);
    instanceRef.current?.resetTransform();
  }, [pdfDoc, currentPage, renderPage]);

  // Re-fit on container resize (e.g. window/panel resize).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let rafId: number;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!pdfDoc) return;
        renderPage(currentPage);
        instanceRef.current?.resetTransform();
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(rafId);
    };
  }, [pdfDoc, currentPage, renderPage]);

  const goTo = (page: number) => {
    if (page >= 1 && page <= totalPages) setCurrentPage(page);
  };

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className={`bg-muted rounded-xl overflow-hidden h-[60vh] md:h-[75vh] min-h-0 p-4 flex items-center justify-center ${
          isBlocked ? 'blur-md pointer-events-none select-none' : ''
        }`}
      >
        <TransformWrapper
          ref={instanceRef}
          {...VIEWER_TRANSFORM_PROPS}
          disabled={isBlocked}
          onTransform={(_ref, state) => setScale(state.scale)}
        >
          <TransformComponent wrapperClass="!cursor-grab active:!cursor-grabbing">
            <canvas
              ref={canvasRef}
              className="shadow-lg rounded bg-white mx-auto"
              style={{ display: 'block' }}
            />
          </TransformComponent>
        </TransformWrapper>
      </div>

      {isErrorDoc && !reprocessing && <ErrorOverlay />}
      {reprocessing && (
        <ProcessingOverlay onCancel={onCancelReprocess} isReprocess={isReprocess} />
      )}

      {!isBlocked && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex flex-wrap items-center justify-center gap-0.5 max-w-[calc(100vw-1.5rem)] bg-background/80 backdrop-blur rounded-lg p-0.5 shadow-md">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goTo(currentPage - 1)}
            disabled={currentPage <= 1}
            title={t('prevPage')}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground px-1 min-w-[40px] text-center tabular-nums">
            {currentPage} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => goTo(currentPage + 1)}
            disabled={currentPage >= totalPages}
            title={t('nextPage')}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <div className="w-px h-5 bg-border mx-0.5" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.zoomOut(0.4)}
            title={t('zoomOut')}
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground w-9 text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.zoomIn(0.4)}
            title={t('zoomIn')}
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => instanceRef.current?.resetTransform()}
            disabled={scale === 1}
            title={t('zoomReset')}
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
  const t = useTranslations('DocumentViewer');
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="text-center p-8 bg-background/70 backdrop-blur-sm rounded-2xl">
        <div className="relative inline-block">
          <CancelableLoader size="lg" onCancel={onCancel} />
        </div>
        <p className="font-medium text-foreground mb-2 mt-6">
          {isReprocess ? t('reprocessing') : t('processing')}
        </p>
        <p className="text-sm text-muted-foreground">
          {onCancel ? t('cancelHint') : t('analyzing')}
        </p>
      </div>
    </div>
  );
}

function ErrorOverlay() {
  const t = useTranslations('DocumentViewer');
  return (
    <div className="absolute inset-0 flex items-center justify-center z-10">
      <div className="text-center p-8 bg-background/70 backdrop-blur-sm rounded-2xl">
        <FileText className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
        <p className="font-medium text-foreground mb-2">{t('errorTitle')}</p>
        <p className="text-sm text-muted-foreground">{t('errorDesc')}</p>
      </div>
    </div>
  );
}
