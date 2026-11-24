import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "pdfjs-dist/web/pdf_viewer.css";
import type { DocSource } from "../lib/docSource";
import { TEXT_LAYER_ATTR, createRenderer, type PageRenderer, type Size } from "../lib/renderers";
import {
  HL_COLORS,
  HL_CSS,
  HL_LABEL,
  hitHighlight,
  mergeRects,
  toRelativeRects,
  type Box,
  type Highlight,
  type HlColor,
} from "../lib/annotations";

export interface DocViewerHandle {
  goTo: (page: number) => void;
  /** 지금 선택한 글자를 칠한다. 선택이 없으면 false */
  highlightSelection: (color: HlColor) => boolean;
}

/** 쪽으로 이동할 때의 스크롤 위치: 가운데 맞춤이 켜져 있고 쪽이 화면에 들어가면 가운데, 아니면 쪽 맨 위 */
function pageTop(root: HTMLElement, el: HTMLElement, center: boolean): number {
  if (center && el.offsetHeight + 24 <= root.clientHeight) {
    return Math.max(0, el.offsetTop + el.offsetHeight / 2 - root.clientHeight / 2);
  }
  return el.offsetTop - 12;
}

export type NewHighlight = Pick<Highlight, "page" | "color" | "rects" | "text">;

interface Props {
  doc: DocSource;
  scale: number;
  onPageChange: (page: number) => void;
  onSelect: (text: string) => void;
  /** 처음 열 때 이동할 페이지 (저장된 마지막 페이지) */
  initialPage?: number;
  highlights: Highlight[];
  /** 지금 보는 쪽 번호 (주황 테두리로 표시) */
  currentPage: number;
  showMarker: boolean;
  /** 각 쪽 오른쪽 아래에 쪽 번호를 작게 표시 */
  showPageNumbers: boolean;
  /** 쪽을 화면 세로 가운데에 맞춰 멈추게 한다 */
  snapPages: boolean;
  /** 형광펜 모드: 이 색이 정해져 있으면 글자를 선택하는 즉시 칠한다 */
  penColor: HlColor | null;
  onAddHighlight: (h: NewHighlight) => void;
  onChangeHighlight: (id: string, patch: Partial<Pick<Highlight, "color" | "note">>) => void;
  onRemoveHighlight: (id: string) => void;
}

const NO_HIGHLIGHTS: Highlight[] = [];

/**
 * 선택 영역에 들어 있는 "글자"의 화면 사각형들. 도형·칸 같은 상자가 통째로 선택에 들어 있어도
 * 그 상자 전체를 칠하지 않도록, 글 노드(텍스트)의 사각형만 모은다.
 */
function textRects(layer: Element, range: Range): DOMRect[] {
  const out: DOMRect[] = [];
  const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (!range.intersectsNode(node)) continue;
    const start = node === range.startContainer ? range.startOffset : 0;
    const end = node === range.endContainer ? range.endOffset : node.length;
    if (end <= start) continue;
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, end);
    out.push(...Array.from(r.getClientRects()));
  }
  return out;
}

/** 500쪽짜리도 버벅이지 않도록, 화면 근처의 페이지만 실제로 그린다. */
const PageView = ({
  renderer,
  pageNumber,
  scale,
  baseSize,
  rootRef,
  register,
  highlights,
  current,
}: {
  renderer: PageRenderer;
  /** 지금 보는 쪽이면 주황 테두리 */
  current: boolean;
  pageNumber: number;
  scale: number;
  baseSize: Size;
  rootRef: React.RefObject<HTMLDivElement | null>;
  register: (n: number, el: HTMLDivElement | null) => void;
  highlights: Highlight[];
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
    const ac = new AbortController();
    renderer
      .render(pageNumber, holder, scale, ac.signal)
      .then((actual) => {
        if (actual && !ac.signal.aborted) setSize(actual);
      })
      .catch(() => {});
    return () => {
      ac.abort();
      holder.replaceChildren();
    };
  }, [near, renderer, pageNumber, scale]);

  const s = size ?? baseSize;
  return (
    <div
      ref={wrapRef}
      className={`page${current ? " mark-current" : ""}`}
      data-page={pageNumber}
      style={{ width: s.w * scale, height: s.h * scale, ["--total-scale-factor" as string]: scale }}
    >
      <div ref={contentRef} className="page-content" />
      {highlights.length > 0 && (
        <div className="hl-layer" aria-hidden="true">
          {highlights.map((h) =>
            h.rects.map((r, i) => (
              <span
                key={`${h.id}-${i}`}
                className={`hl${h.note ? " has-note" : ""}`}
                data-hl={h.id}
                style={{
                  left: `${r.x * 100}%`,
                  top: `${r.y * 100}%`,
                  width: `${r.w * 100}%`,
                  height: `${r.h * 100}%`,
                  background: HL_CSS[h.color],
                }}
              />
            )),
          )}
        </div>
      )}
      <span className="page-label">{pageNumber}</span>
    </div>
  );
};

export const DocViewer = forwardRef<DocViewerHandle, Props>(function DocViewer(
  {
    doc,
    scale,
    onPageChange,
    onSelect,
    initialPage,
    highlights,
    currentPage,
    showMarker,
    showPageNumbers,
    snapPages,
    penColor,
    onAddHighlight,
    onChangeHighlight,
    onRemoveHighlight,
  },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const [baseSize, setBaseSize] = useState<Size | null>(null);
  const lastPage = useRef(0);
  // 저장된 페이지로 이동하기 전에는 "현재 페이지 = 1" 을 알리지 않는다 (마지막 페이지 기록을 덮어쓰지 않도록)
  const pendingInitial = useRef((initialPage ?? 1) > 1);
  const ratio = useRef(0);

  const renderer = useMemo(() => createRenderer(doc), [doc]);
  useEffect(() => {
    let alive = true;
    renderer.baseSize().then((size) => {
      if (alive) setBaseSize(size);
    });
    return () => {
      alive = false;
    };
  }, [renderer]);

  const register = useCallback((n: number, el: HTMLDivElement | null) => {
    pageEls.current[n] = el;
  }, []);

  /** 화면 세로 중앙에 걸린 페이지를 "현재 페이지"로 본다. (이분 탐색) */
  const detectPage = useCallback(() => {
    const root = rootRef.current;
    if (!root || pendingInitial.current) return;
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
    // 가운데 맞춤: 스크롤바를 끌거나 멈춘 뒤에도 쪽이 가운데에 오도록 잠시 후 맞춘다.
    clearTimeout(settle.current);
    if (snapPages) settle.current = window.setTimeout(settleToCenter, 220);
  };

  const settle = useRef(0);
  const settleToCenter = () => {
    const root = rootRef.current;
    const el = pageEls.current[lastPage.current];
    if (!root || !el || el.offsetHeight + 24 > root.clientHeight) return;
    const top = pageTop(root, el, true);
    if (Math.abs(top - root.scrollTop) > 2) root.scrollTo({ top, behavior: "smooth" });
  };

  // 가운데 맞춤: 휠을 한 번 굴리면 앞뒤 한 쪽씩 넘긴다. (쪽이 화면보다 크면 그 안에서는 평소처럼 스크롤)
  const wheelState = useRef({ at: 0, flipped: 0 });
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !snapPages) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const cur = pageEls.current[lastPage.current];
      if (!cur || cur.offsetHeight + 24 > root.clientHeight) return;
      e.preventDefault();
      const st = wheelState.current;
      const now = performance.now();
      const gap = now - st.at;
      st.at = now;
      // 트랙패드의 연속된 작은 움직임(관성 포함)은 한 번으로 본다. 마우스 휠은 칸마다 넘긴다.
      const small = Math.abs(e.deltaY) < 50;
      if (now - st.flipped < 300 || (small && gap < 200)) return;
      st.flipped = now;
      const target = Math.min(Math.max(1, lastPage.current + (e.deltaY > 0 ? 1 : -1)), doc.numPages);
      const el = pageEls.current[target];
      if (el) root.scrollTo({ top: pageTop(root, el, true), behavior: "smooth" });
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [snapPages, doc]);

  // 확대/축소해도 보던 위치가 유지되도록 스크롤 비율을 복원한다.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.scrollTop = ratio.current * root.scrollHeight;
    detectPage();
  }, [scale, baseSize, detectPage]);

  // 페이지 요소가 등록된 뒤(자식 effect 이후) 저장된 마지막 페이지로 이동한다.
  useEffect(() => {
    if (!baseSize || !pendingInitial.current) return;
    pendingInitial.current = false;
    const root = rootRef.current;
    const el = pageEls.current[Math.min(Math.max(1, initialPage ?? 1), doc.numPages)];
    if (root && el) root.scrollTo({ top: pageTop(root, el, snapPages) });
    requestAnimationFrame(detectPage);
  }, [baseSize, initialPage, doc, detectPage]);

  /** 선택한 글자를 쪽별로 나눠 칠한다. 칠한 게 있으면 true */
  const applyHighlight = useCallback(
    (color: HlColor): boolean => {
      const sel = window.getSelection();
      const root = rootRef.current;
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !root) return false;
      const range = sel.getRangeAt(0);
      const pageOf = (n: Node) => (n instanceof Element ? n : n.parentElement)?.closest<HTMLElement>(".page") ?? null;
      const first = pageOf(range.startContainer);
      const last = pageOf(range.endContainer);
      if (!first || !last) return false;
      const from = Number(first.dataset.page);
      const to = Number(last.dataset.page);
      let added = false;
      for (let p = Math.min(from, to); p <= Math.max(from, to); p++) {
        const pageEl = pageEls.current[p];
        const layer = pageEl?.querySelector<HTMLElement>(`[${TEXT_LAYER_ATTR}]`);
        if (!pageEl || !layer) continue;
        // 이 쪽의 글자 레이어와 선택 영역이 겹치는 부분만 잘라낸다.
        const part = document.createRange();
        part.selectNodeContents(layer);
        if (range.comparePoint(layer, 0) === -1) part.setStart(range.startContainer, range.startOffset);
        if (range.comparePoint(layer, layer.childNodes.length) === 1) part.setEnd(range.endContainer, range.endOffset);
        const text = part.toString().replace(/\s+/g, " ").trim();
        if (!text) continue;
        const box = pageEl.getBoundingClientRect();
        const rects = mergeRects(toRelativeRects(textRects(layer, part) as Box[], box));
        if (rects.length === 0) continue;
        onAddHighlight({ page: p, color, rects, text });
        added = true;
      }
      if (added) {
        sel.removeAllRanges();
        onSelect("");
      }
      return added;
    },
    [onAddHighlight, onSelect],
  );

  useImperativeHandle(ref, () => ({
    goTo(page: number) {
      const root = rootRef.current;
      const el = pageEls.current[Math.min(Math.max(1, page), doc.numPages)];
      if (root && el) root.scrollTo({ top: pageTop(root, el, snapPages) });
    },
    highlightSelection: applyHighlight,
  }));

  /** 글자를 선택하고 마우스를 놓은 자리 옆에 띄우는 색 고르기 막대 */
  const [bar, setBar] = useState<{ x: number; y: number } | null>(null);
  /** 칠해 둔 곳을 눌렀을 때 뜨는 메모·색 바꾸기·삭제 창 */
  const [pop, setPop] = useState<{ id: string; x: number; y: number } | null>(null);

  const onMouseUp = () => {
    const sel = window.getSelection();
    onSelect(sel?.toString() ?? "");
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return setBar(null);
    if (penColor) {
      applyHighlight(penColor);
      return setBar(null);
    }
    const rects = sel.getRangeAt(0).getClientRects();
    const end = rects[rects.length - 1];
    setPop(null);
    setBar(end ? { x: end.right, y: end.bottom } : null);
  };

  const onClick = (e: React.MouseEvent) => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // 드래그로 글자를 고르는 중
    setBar(null);
    const pageEl = (e.target as Element).closest<HTMLElement>(".page");
    if (!pageEl) return setPop(null);
    const box = pageEl.getBoundingClientRect();
    const hit = hitHighlight(
      highlights,
      Number(pageEl.dataset.page),
      (e.clientX - box.left) / box.width,
      (e.clientY - box.top) / box.height,
    );
    setPop(hit ? { id: hit.id, x: e.clientX, y: e.clientY } : null);
  };

  useEffect(() => {
    if (!pop && !bar) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPop(null);
        setBar(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pop, bar]);

  const byPage = new Map<number, Highlight[]>();
  for (const h of highlights) {
    const list = byPage.get(h.page);
    if (list) list.push(h);
    else byPage.set(h.page, [h]);
  }
  const popHl = pop ? highlights.find((h) => h.id === pop.id) : undefined;
  const place = (x: number, y: number, w: number) => ({
    left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    top: Math.min(y + 8, window.innerHeight - 220),
  });

  return (
    <div
      className={`viewer${penColor ? " pen" : ""}${snapPages ? " snap" : ""}${showPageNumbers ? "" : " no-labels"}`}
      ref={rootRef}
      onScroll={() => {
        onScroll();
        setBar(null);
        setPop(null);
      }}
      onMouseUp={onMouseUp}
      onClick={onClick}
    >
      {baseSize &&
        Array.from({ length: doc.numPages }, (_, i) => (
          <PageView
            key={i + 1}
            renderer={renderer}
            pageNumber={i + 1}
            scale={scale}
            baseSize={baseSize}
            rootRef={rootRef}
            register={register}
            highlights={byPage.get(i + 1) ?? NO_HIGHLIGHTS}
            current={showMarker && i + 1 === currentPage}
          />
        ))}
      {bar && !penColor && (
        <div className="sel-bar" style={place(bar.x, bar.y, 190)} onMouseDown={(e) => e.preventDefault()}>
          {HL_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="swatch"
              style={{ background: HL_CSS[c] }}
              title={`${HL_LABEL[c]}으로 칠하기`}
              aria-label={`${HL_LABEL[c]}으로 칠하기`}
              onClick={() => {
                applyHighlight(c);
                setBar(null);
              }}
            />
          ))}
        </div>
      )}
      {pop && popHl && (
        <div className="hl-pop" style={place(pop.x, pop.y, 260)} onClick={(e) => e.stopPropagation()}>
          <div className="hl-pop-colors">
            {HL_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`swatch${popHl.color === c ? " on" : ""}`}
                style={{ background: HL_CSS[c] }}
                title={HL_LABEL[c]}
                aria-label={HL_LABEL[c]}
                onClick={() => onChangeHighlight(popHl.id, { color: c })}
              />
            ))}
            <span className="spacer" />
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                onRemoveHighlight(popHl.id);
                setPop(null);
              }}
            >
              삭제
            </button>
          </div>
          <div className="hl-pop-text" title={popHl.text}>
            {popHl.text.length > 90 ? popHl.text.slice(0, 90) + "…" : popHl.text}
          </div>
          <textarea
            rows={3}
            autoFocus
            placeholder="이 부분에 메모 (자동 저장)"
            value={popHl.note ?? ""}
            onChange={(e) => onChangeHighlight(popHl.id, { note: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") setPop(null);
              e.stopPropagation();
            }}
          />
        </div>
      )}
    </div>
  );
});
