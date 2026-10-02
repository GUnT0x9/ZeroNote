"use client";
import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { errorMessage, type LocalAttachment } from "@/lib/database";
import pdfPackage from "pdfjs-dist/package.json";
let library: Promise<typeof import("pdfjs-dist")> | undefined;
async function loadPdfLibrary() {
  library ??= import("pdfjs-dist")
    .then((pdf) => {
      pdf.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdf;
    })
    .catch((error) => {
      library = undefined;
      throw error;
    });
  return library;
}
export function PdfPreview({ file }: { file: LocalAttachment }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="attachment-text"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>PDF 미리보기</summary>
      {open && <PdfPages file={file} />}
    </details>
  );
}
function PdfPages({ file }: { file: LocalAttachment }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    container = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [pageNumber, setPageNumber] = useState(1),
    [error, setError] = useState(""),
    [text, setText] = useState(""),
    [busy, setBusy] = useState(true);
  useEffect(() => {
    let cancelled = false,
      task:
        ReturnType<(typeof import("pdfjs-dist"))["getDocument"]> | undefined;
    void loadPdfLibrary()
      .then(async (sdk) => {
        if (cancelled) return;
        task = sdk.getDocument({
          data: Uint8Array.from(file.data),
          cMapUrl: `/pdfjs/${pdfPackage.version}/cmaps/`,
          cMapPacked: true,
          iccUrl: `/pdfjs/${pdfPackage.version}/iccs/`,
          standardFontDataUrl: `/pdfjs/${pdfPackage.version}/standard_fonts/`,
          wasmUrl: `/pdfjs/${pdfPackage.version}/wasm/`,
          maxImageSize: 16_000_000,
          useSystemFonts: true,
        });
        const document = await task.promise;
        if (!cancelled) {
          setPdf(document);
          setPageNumber(1);
        }
      })
      .catch((problem) => {
        if (!cancelled) {
          setError(errorMessage(problem));
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
      if (task) void task.destroy().catch(() => {});
    };
  }, [file.id]);
  useEffect(() => {
    if (!pdf) return;
    let cancelled = false,
      render: RenderTask | undefined;
    setBusy(true);
    setError("");
    setText("");
    void (async () => {
      const page = await pdf.getPage(pageNumber),
        target = canvas.current;
      if (cancelled || !target) return;
      const context = target.getContext("2d");
      if (!context) throw new Error("PDF 화면을 준비하지 못했습니다.");
      const base = page.getViewport({ scale: 1 }),
        width = Math.min(container.current?.clientWidth ?? 600, 760);
      const scale = Math.min(
        (width / base.width) * Math.min(window.devicePixelRatio || 1, 2),
        2,
        Math.sqrt(4_000_000 / (base.width * base.height)),
      );
      const viewport = page.getViewport({ scale });
      target.width = Math.max(1, Math.ceil(viewport.width));
      target.height = Math.max(1, Math.ceil(viewport.height));
      render = page.render({
        canvas: target,
        canvasContext: context,
        viewport,
      });
      await render.promise;
      const content = await page.getTextContent();
      if (!cancelled) {
        setText(
          content.items
            .flatMap((item) => ("str" in item ? [item.str] : []))
            .join(" "),
        );
        setBusy(false);
      }
    })().catch((problem) => {
      if (!cancelled) {
        setError(errorMessage(problem));
        setBusy(false);
      }
    });
    return () => {
      cancelled = true;
      render?.cancel();
    };
  }, [pdf, pageNumber]);
  return (
    <div ref={container} className="pdf-pages" aria-busy={busy}>
      <div className="pdf-page-controls">
        <button
          className="button button-small"
          disabled={!pdf || busy || pageNumber <= 1}
          onClick={() => setPageNumber((value) => value - 1)}
        >
          이전 Page
        </button>
        <span>
          {pageNumber} / {pdf?.numPages ?? "…"}
        </span>
        <button
          className="button button-small"
          disabled={!pdf || busy || pageNumber >= (pdf?.numPages ?? 0)}
          onClick={() => setPageNumber((value) => value + 1)}
        >
          다음 Page
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <canvas
        ref={canvas}
        role="img"
        aria-label={`${file.name} · Page ${pageNumber}`}
        hidden={!!error}
      />
      <p className="sr-only">{text}</p>
    </div>
  );
}
