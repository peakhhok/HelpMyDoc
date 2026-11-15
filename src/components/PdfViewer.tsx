import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { TextLayer } from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import "pdfjs-dist/web/pdf_viewer.css";

export interface PdfViewerHandle {
  goTo: (page: number) => void;
}

interface Props {
  doc: PDFDocumentProxy;
  scale: number;
  onPageChange: (page: number) => void;
  onSelect: (text: string) => void;
}

interface Size {
  w: number;
  h: number;
}

/** 500쪽짜리도 버벅이지 않도록, 화면 근처의 페이지만 실제로 그린다. */
const PageView = ({
  doc,
  pageNumber,
  scale,
  baseSize,
  rootRef,
  register,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  baseSize: Size;
  rootRef: React.RefObject<HTMLDivElement | null>;
  register: (n: number, el: HTMLDivElement | null) => void;
}) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [size, setSize] = useState<Size | null>(null);

  useEffect(() => {
    register(pageNumber, wrapRef.current);
    return () => register(pageNumber, null);
  }, [pageNumber, register]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), {
      root: rootRef.current,
      rootMargin: "1500px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [rootRef]);

  useEffect(() => {
    if (!near) return;
    const holder = contentRef.current;
    if (!holder) return;
    let cancelled = false;
    let renderTask: { cancel: () => void } | null = null;
    let textLayer: TextLayer | null = null;

    (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      setSize({ w: base.width, h: base.height });
      const viewport = page.getViewport({ scale });
      const dpr = window.devicePixelRatio || 1;

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const textDiv = document.createElement("div");
      textDiv.className = "textLayer";

      const task = page.render({
        canvas,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      renderTask = task;
      try {
        await task.promise;
      } catch {
        return; // 취소됨
      }
      if (cancelled) return;
      holder.replaceChildren(canvas, textDiv);

      textLayer = new TextLayer({
        textContentSource: page.streamTextContent(),
        container: textDiv,
        viewport,
      });
      textLayer.render().catch(() => {});
    })();

    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
      holder.replaceChildren();
    };
  }, [near, doc, pageNumber, scale]);

  const s = size ?? baseSize;
  return (
    <div
      ref={wrapRef}
      className="page"
      data-page={pageNumber}
      style={{ width: s.w * scale, height: s.h * scale, ["--total-scale-factor" as string]: scale }}
    >
      <div ref={contentRef} className="page-content" />
      <span className="page-label">{pageNumber}</span>
    </div>
  );
};

export const PdfViewer = forwardRef<PdfViewerHandle, Props>(function PdfViewer(
  { doc, scale, onPageChange, onSelect },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const lastPage = useRef(0);
  const ratio = useRef(0);

  useEffect(() => {
    let alive = true;
    doc.getPage(1).then((p) => {
      if (!alive) return;
      const v = p.getViewport({ scale: 1 });
      setBaseSize({ w: v.width, h: v.height });
    });
    return () => {
      alive = false;
    };
  }, [doc]);

  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    pageEls.current[n] = el;
  }, []);

  /** 화면 세로 중앙에 걸린 페이지를 "현재 페이지"로 본다. (이분 탐색) */
  const detectPage = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const center = root.scrollTop + root.clientHeight / 2;
    let lo = 1;
    let hi = doc.numPages;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      const el = pageEls.current[mid];
      if (el && el.offsetTop <= center) lo = mid;
      else hi = mid - 1;
    }
    if (lo !== lastPage.current) {
      lastPage.current = lo;
      onPageChange(lo);
    }
  }, [doc, onPageChange]);

  const raf = useRef(0);
  const onScroll = () => {
    const root = rootRef.current;
    if (root) ratio.current = root.scrollTop / Math.max(1, root.scrollHeight);
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(detectPage);
  };

  // 확대/축소해도 보던 위치가 유지되도록 스크롤 비율을 복원한다.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollTop = ratio.current * root.scrollHeight;
    detectPage();
  }, [scale, baseSize, detectPage]);

  useImperativeHandle(ref, () => ({
    goTo(page: number) {
      const root = rootRef.current;
      const el = pageEls.current[Math.min(Math.max(1, page), doc.numPages)];
      if (root && el) root.scrollTo({ top: el.offsetTop - 12 });
    },
  }));

  const onMouseUp = () => onSelect(window.getSelection()?.toString() ?? "");

  return (
    <div className="viewer" ref={rootRef} onScroll={onScroll} onMouseUp={onMouseUp}>
      {baseSize &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageView
            key={i + 1}
            doc={doc}
            pageNumber={i + 1}
            scale={scale}
            baseSize={baseSize}
            rootRef={rootRef}
            register={register}
          />
        ))}
    </div>
  );
});
