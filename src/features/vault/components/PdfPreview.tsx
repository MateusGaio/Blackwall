// MIT License — Copyright (c) 2026 Mateus Gaio

import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type OnProgressParameters,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ProgressIndicator } from "../../../shared/components/motion/ProgressIndicator";
import { Skeleton } from "../../../shared/components/motion/Skeleton";
import { Button } from "../../../shared/components/ui/button";
import { cn } from "../../../shared/lib/utils";

type PdfPreviewProps = {
  bytes: Uint8Array;
};

export function PdfPreview({ bytes }: PdfPreviewProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const [documentState, setDocumentState] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setLoading(true);
    setProgress(undefined);
    setError("");
    setDocumentState(null);
    setPageNumber(1);
    const load = async () => {
      try {
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        GlobalWorkerOptions.workerSrc = worker.default;
        const task = getDocument({ data: bytes });
        task.onProgress = ({ loaded: loadedBytes, total }: OnProgressParameters) => {
          if (!cancelled && total > 0) setProgress(Math.round((loadedBytes / total) * 100));
        };
        loaded = await task.promise;
        if (cancelled) {
          await loaded.destroy();
          return;
        }
        documentRef.current = loaded;
        setDocumentState(loaded);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setLoading(false);
          setError(t("vault.pdfPreviewFailed"));
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
      const current = documentRef.current ?? loaded;
      documentRef.current = null;
      if (current) void current.destroy();
    };
  }, [bytes, t]);

  useEffect(() => {
    if (!documentState || !canvasRef.current) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    const render = async () => {
      try {
        const page = await documentState.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTaskRef.current = page.render({
          annotationMode: AnnotationMode.DISABLE,
          canvas,
          canvasContext: context,
          viewport,
        });
        await renderTaskRef.current.promise;
      } catch {
        if (!cancelled) setError(t("vault.pdfPreviewFailed"));
      }
    };
    void render();
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
    };
  }, [documentState, pageNumber, scale, t]);

  if (loading) {
    return (
      <div aria-busy="true" className="grid gap-2 p-3">
        <ProgressIndicator label={t("vault.pdfLoading")} value={progress} />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (error || !documentState) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        {error || t("vault.pdfPreviewFailed")}
      </p>
    );
  }

  return (
    <div className="grid gap-2 p-2">
      <div
        className="flex flex-wrap items-center gap-1"
        role="toolbar"
        aria-label={t("vault.pdfControls")}
      >
        <Button
          disabled={pageNumber <= 1}
          onClick={() => setPageNumber((value) => Math.max(1, value - 1))}
          size="xs"
          variant="outline"
        >
          {t("vault.previousPage")}
        </Button>
        <Button
          disabled={pageNumber >= documentState.numPages}
          onClick={() => setPageNumber((value) => Math.min(documentState.numPages, value + 1))}
          size="xs"
          variant="outline"
        >
          {t("vault.nextPage")}
        </Button>
        <span aria-live="polite" className="px-1 font-mono text-xs text-muted-foreground">
          {t("vault.pageOf", { page: pageNumber, total: documentState.numPages })}
        </span>
        <Button
          onClick={() => setScale((value) => Math.max(0.5, Number((value - 0.1).toFixed(1))))}
          size="xs"
          variant="ghost"
        >
          −
        </Button>
        <span className="font-mono text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
        <Button
          onClick={() => setScale((value) => Math.min(3, Number((value + 0.1).toFixed(1))))}
          size="xs"
          variant="ghost"
        >
          +
        </Button>
        <Button className={cn("ml-auto")} onClick={() => setScale(1)} size="xs" variant="ghost">
          {t("vault.resetZoom")}
        </Button>
      </div>
      <canvas
        aria-label={t("vault.pdfPage", { page: pageNumber })}
        className="h-auto max-w-full rounded border border-border/60"
        ref={canvasRef}
      />
    </div>
  );
}
