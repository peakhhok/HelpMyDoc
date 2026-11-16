// Deck 의 슬라이드 하나를 화면 요소(HTML + SVG)로 그린다.
// 글자는 실제 글자(텍스트 노드)로 그려서 드래그로 고르고 형광펜을 칠할 수 있다.
import type { BoxPt, Deck, FillSpec, LineSpec, Para, Shape, Slide, Spacing, TableCell, TextBody } from "./model";

const SVG_NS = "http://www.w3.org/2000/svg";
/** 한글 글꼴이 지정 안 됐거나 없을 때를 위한 대체 목록 */
const FALLBACK_FONTS = '"Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans CJK KR", "Segoe UI", sans-serif';

export interface RenderOptions {
  /** 미디어 파일 경로 → 화면에 쓸 주소 (blob URL) */
  mediaUrl: (path: string) => string | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: Partial<CSSStyleDeclaration> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e.style, style);
  return e;
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function fillCss(f: FillSpec | null, opts: RenderOptions): Partial<CSSStyleDeclaration> {
  if (!f) return {};
  if (f.type === "solid") return { background: f.css };
  if (f.type === "grad") return { background: f.css };
  const url = opts.mediaUrl(f.media);
  return url ? { backgroundImage: `url("${url}")`, backgroundSize: "cover", backgroundPosition: "center" } : {};
}

function place(e: HTMLElement, box: BoxPt, k: number): void {
  Object.assign(e.style, {
    position: "absolute",
    left: `${box.x * k}px`,
    top: `${box.y * k}px`,
    width: `${box.w * k}px`,
    height: `${box.h * k}px`,
  });
  const t: string[] = [];
  if (box.rot) t.push(`rotate(${box.rot}deg)`);
  if (box.flipH) t.push("scaleX(-1)");
  if (box.flipV) t.push("scaleY(-1)");
  if (t.length) e.style.transform = t.join(" ");
}

function spacing(s: Spacing | undefined, fontPx: number): number {
  if (!s) return 0;
  if (s.pts != null) return s.pts;
  if (s.pct != null) return (fontPx * s.pct) / 100;
  return 0;
}

const ALPHA = "abcdefghijklmnopqrstuvwxyz";
function roman(n: number): string {
  const map: Array<[number, string]> = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"],
  ];
  let out = "";
  let v = n;
  for (const [x, s] of map)
    while (v >= x) {
      out += s;
      v -= x;
    }
  return out;
}

function autoNumber(type: string, n: number): string {
  const lower = type.includes("Lc");
  const suffix = type.endsWith("ParenBoth") ? ")" : type.endsWith("ParenR") ? ")" : type.endsWith("Period") ? "." : "";
  const open = type.endsWith("ParenBoth") ? "(" : "";
  let body: string;
  if (type.startsWith("alpha")) {
    const l = ALPHA[(n - 1) % 26] ?? "a";
    body = lower ? l : l.toUpperCase();
  } else if (type.startsWith("roman")) body = lower ? roman(n) : roman(n).toUpperCase();
  else body = String(n);
  return `${open}${body}${suffix}`;
}

function fontFamily(font: string): string {
  return font ? `"${font.replace(/"/g, "")}", ${FALLBACK_FONTS}` : FALLBACK_FONTS;
}

function renderText(body: TextBody, k: number, container: HTMLElement): void {
  const wrap = el("div", {
    position: "absolute",
    inset: "0",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    justifyContent: body.anchor === "ctr" ? "center" : body.anchor === "b" ? "flex-end" : "flex-start",
    padding: `${body.inset.t * k}px ${body.inset.r * k}px ${body.inset.b * k}px ${body.inset.l * k}px`,
    overflow: "visible",
    whiteSpace: body.wrap ? "pre-wrap" : "pre",
    wordBreak: "keep-all",
    overflowWrap: "anywhere",
  });
  wrap.className = "pp-text";

  const counters: number[] = [];
  body.paras.forEach((p: Para, i) => {
    const first = p.runs.find((r) => !r.br);
    const sizePt = first?.size ?? p.endSize;
    const fontPx = sizePt * k;
    const div = el("div", {
      textAlign: p.algn === "just" ? "justify" : p.algn === "ctr" ? "center" : p.algn === "r" ? "right" : "left",
      marginTop: i === 0 ? "0" : `${spacing(p.spcBef, sizePt) * k}px`,
      marginBottom: `${spacing(p.spcAft, sizePt) * k}px`,
      lineHeight:
        p.lnSpc?.pts != null
          ? `${p.lnSpc.pts * k}px`
          : `${Math.max(0.5, ((p.lnSpc?.pct ?? 100) / 100) * (1 - body.lnSpcReduction)) * 1.2}`,
      minHeight: `${fontPx * 1.2}px`,
      paddingLeft: `${Math.max(0, p.marL) * k}px`,
      // 글머리표가 있으면 글머리표가 (marL + indent) 에, 글은 marL 에서 시작한다. 없으면 첫 줄만 indent 만큼 당긴다.
      textIndent: p.bullet && (p.bullet.char || p.bullet.auto) ? "0" : `${p.indent * k}px`,
      position: "relative",
    });
    div.className = "pp-para";

    if (p.bullet && (p.bullet.char || p.bullet.auto)) {
      counters.length = p.lvl + 1;
      const n = (counters[p.lvl] = (counters[p.lvl] ?? 0) + 1);
      const mark = p.bullet.auto ? autoNumber(p.bullet.auto, n) : (p.bullet.char as string);
      const b = el("span", {
        position: "absolute",
        left: `${(Math.max(0, p.marL) + Math.min(0, p.indent)) * k}px`,
        color: p.bullet.color ?? first?.color ?? "inherit",
        fontSize: `${fontPx * ((p.bullet.sizePct ?? 100) / 100)}px`,
        fontFamily:
          p.bullet.font && !/wingdings|symbol/i.test(p.bullet.font) ? fontFamily(p.bullet.font) : FALLBACK_FONTS,
        textIndent: "0",
        userSelect: "none",
      });
      b.setAttribute("aria-hidden", "true");
      b.setAttribute("data-bullet", "");
      // 글머리표는 CSS 가 그려서 드래그로 고른 글에 섞이지 않는다.
      b.style.setProperty("--mark", JSON.stringify(mark));
      b.className = "pp-bullet";
      div.appendChild(b);
    } else {
      counters.length = Math.min(counters.length, p.lvl);
    }

    if (p.runs.every((r) => !r.br && r.text === "")) {
      div.appendChild(document.createElement("br"));
    }
    for (const r of p.runs) {
      if (r.br) {
        div.appendChild(document.createElement("br"));
        continue;
      }
      const span = el("span", {
        fontSize: `${r.size * k * (r.baseline ? 0.65 : 1)}px`,
        fontFamily: fontFamily(r.font),
        fontWeight: r.bold ? "700" : "400",
        fontStyle: r.italic ? "italic" : "normal",
        color: r.color,
        textDecoration:
          [r.underline ? "underline" : "", r.strike ? "line-through" : ""].filter(Boolean).join(" ") || "none",
        verticalAlign: r.baseline > 0 ? "super" : r.baseline < 0 ? "sub" : "baseline",
      });
      span.textContent = r.text;
      div.appendChild(span);
    }
    wrap.appendChild(div);
  });
  container.appendChild(wrap);
}

function lineStroke(line: LineSpec, k: number): Record<string, string | number> {
  const a: Record<string, string | number> = {
    stroke: line.css,
    "stroke-width": Math.max(0.5, line.w * k),
    fill: "none",
  };
  if (line.dash === "dash") a["stroke-dasharray"] = `${6 * line.w * k} ${3 * line.w * k}`;
  if (line.dash === "dot") a["stroke-dasharray"] = `${line.w * k} ${2 * line.w * k}`;
  return a;
}

/** 크기에 따라 모양이 달라지는 화살표·쉐브론을 0~1 비율의 다각형으로 바꾼다. */
function dynamicPoints(
  g: Extract<Shape, { kind: "shape" }>["geom"],
  w: number,
  h: number,
): Array<[number, number]> | null {
  if (w <= 0 || h <= 0) return null;
  if (g.kind === "arrow") {
    const horizontal = g.dir === "left" || g.dir === "right";
    const along = horizontal ? w : h;
    const across = horizontal ? h : w;
    const head = Math.min(along, Math.min(w, h) * g.head);
    const shaft = across * Math.min(1, Math.max(0, g.shaft));
    const a = (across - shaft) / 2;
    const b = (across + shaft) / 2;
    const base = along - head;
    // 오른쪽 화살표를 기준으로 (길이 방향 x, 폭 방향 y) 좌표를 만든 뒤 방향에 맞게 돌린다.
    const pts: Array<[number, number]> = [
      [0, a],
      [base, a],
      [base, 0],
      [along, across / 2],
      [base, across],
      [base, b],
      [0, b],
    ];
    return pts.map(([x, y]) => {
      if (g.dir === "right") return [x / w, y / h];
      if (g.dir === "left") return [(along - x) / w, y / h];
      if (g.dir === "down") return [y / w, x / h];
      return [y / w, (along - x) / h];
    });
  }
  if (g.kind === "chevron") {
    const d = Math.min(w, Math.min(w, h) * g.depth);
    const pts: Array<[number, number]> = g.home
      ? [
          [0, 0],
          [w - d, 0],
          [w, h / 2],
          [w - d, h],
          [0, h],
        ]
      : [
          [0, 0],
          [w - d, 0],
          [w, h / 2],
          [w - d, h],
          [0, h],
          [d, h / 2],
        ];
    return pts.map(([x, y]) => [x / w, y / h]);
  }
  return null;
}

function renderShape(s: Extract<Shape, { kind: "shape" }>, k: number, opts: RenderOptions, parent: HTMLElement): void {
  const root = el("div");
  place(root, s.box, k);
  const w = s.box.w * k;
  const h = s.box.h * k;
  const dyn = dynamicPoints(s.geom, w, h);
  const geom = dyn ? ({ kind: "poly", points: dyn } as const) : s.geom;
  const border = s.line
    ? `${Math.max(0.5, s.line.w * k)}px ${s.line.dash ? (s.line.dash === "dot" ? "dotted" : "dashed") : "solid"} ${s.line.css}`
    : "none";

  if (geom.kind === "poly" || geom.kind === "path") {
    const vbW = geom.kind === "path" ? geom.w : 1;
    const vbH = geom.kind === "path" ? geom.h : 1;
    const g = svg("svg", { width: w, height: h, viewBox: `0 0 ${vbW} ${vbH}`, preserveAspectRatio: "none" });
    g.style.position = "absolute";
    g.style.inset = "0";
    g.style.overflow = "visible";
    const shape =
      geom.kind === "path"
        ? svg("path", { d: geom.d })
        : svg("polygon", { points: geom.points.map(([x, y]) => `${x},${y}`).join(" ") });
    if (s.fill?.type === "solid" || s.fill?.type === "grad")
      shape.setAttribute("fill", s.fill.type === "solid" ? s.fill.css : firstColor(s.fill.css));
    else shape.setAttribute("fill", "none");
    if (s.line) {
      shape.setAttribute("stroke", s.line.css);
      shape.setAttribute("stroke-width", String(Math.max(0.5, s.line.w * k)));
      shape.setAttribute("vector-effect", "non-scaling-stroke");
    }
    g.appendChild(shape);
    root.appendChild(g);
  } else {
    Object.assign(root.style, fillCss(s.fill, opts), { border, boxSizing: "border-box" });
    if (geom.kind === "ellipse") root.style.borderRadius = "50%";
    if (geom.kind === "roundRect") root.style.borderRadius = `${Math.min(w, h) * geom.radius}px`;
  }
  if (s.text) renderText(s.text, k, root);
  parent.appendChild(root);
}

function firstColor(gradientCss: string): string {
  const m = gradientCss.match(/rgba?\([^)]*\)/);
  return m ? m[0] : "none";
}

function renderLine(s: Extract<Shape, { kind: "line" }>, k: number, parent: HTMLElement): void {
  const root = el("div");
  place(root, s.box, k);
  const w = Math.max(1, s.box.w * k);
  const h = Math.max(1, s.box.h * k);
  const g = svg("svg", { width: w, height: h, viewBox: `0 0 ${w} ${h}` });
  g.style.position = "absolute";
  g.style.inset = "0";
  g.style.overflow = "visible";
  const id = `pp-arrow-${Math.random().toString(36).slice(2, 8)}`;
  if (s.line.head || s.line.tail) {
    const defs = svg("defs");
    for (const [suffix, orient] of [
      ["t", "auto"],
      ["h", "auto-start-reverse"],
    ] as const) {
      const m = svg("marker", { id: `${id}-${suffix}`, markerWidth: 8, markerHeight: 8, refX: 6, refY: 4, orient });
      m.appendChild(svg("path", { d: "M0,0 L8,4 L0,8 z", fill: s.line.css }));
      defs.appendChild(m);
    }
    g.appendChild(defs);
  }
  const line = svg("line", { x1: 0, y1: 0, x2: w, y2: h, ...lineStroke(s.line, k) });
  if (s.line.tail) line.setAttribute("marker-end", `url(#${id}-t)`);
  if (s.line.head) line.setAttribute("marker-start", `url(#${id}-h)`);
  g.appendChild(line);
  root.appendChild(g);
  parent.appendChild(root);
}

function renderPic(s: Extract<Shape, { kind: "pic" }>, k: number, opts: RenderOptions, parent: HTMLElement): void {
  const root = el("div", { overflow: "hidden" });
  place(root, s.box, k);
  const url = s.media ? opts.mediaUrl(s.media) : null;
  if (!url) {
    Object.assign(root.style, {
      border: "1px dashed rgba(120, 120, 120, 0.8)",
      background: "rgba(200, 200, 200, 0.25)",
      color: "rgb(110, 110, 110)",
      font: `${Math.max(10, 11 * k)}px ${FALLBACK_FONTS}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      textAlign: "center",
    });
    root.textContent = s.alt ? `그림: ${s.alt}` : "그림 (이 형식은 표시하지 못해요)";
    root.setAttribute("data-approx", "");
  } else {
    const img = el("img", { position: "absolute", display: "block", maxWidth: "none" });
    img.src = url;
    img.alt = s.alt;
    img.draggable = false;
    const c = s.crop;
    if (c && (c.l || c.t || c.r || c.b)) {
      const vw = 1 - c.l - c.r;
      const vh = 1 - c.t - c.b;
      img.style.width = `${100 / Math.max(0.01, vw)}%`;
      img.style.height = `${100 / Math.max(0.01, vh)}%`;
      img.style.left = `${(-c.l / Math.max(0.01, vw)) * 100}%`;
      img.style.top = `${(-c.t / Math.max(0.01, vh)) * 100}%`;
    } else {
      img.style.width = "100%";
      img.style.height = "100%";
    }
    root.appendChild(img);
  }
  parent.appendChild(root);
}

function cellBorder(l: LineSpec | undefined, k: number): string {
  return l ? `${Math.max(0.5, l.w * k)}px solid ${l.css}` : "none";
}

function renderTable(s: Extract<Shape, { kind: "table" }>, k: number, parent: HTMLElement): void {
  const root = el("div");
  place(root, s.box, k);
  const table = el("table", {
    borderCollapse: "collapse",
    tableLayout: "fixed",
    width: `${s.cols.reduce((a, b) => a + b, 0) * k}px`,
  });
  const colgroup = document.createElement("colgroup");
  for (const w of s.cols) colgroup.appendChild(el("col", { width: `${w * k}px` }));
  table.appendChild(colgroup);
  for (const row of s.rows) {
    const tr = el("tr", { height: `${row.h * k}px` });
    for (const c of row.cells as TableCell[]) {
      if (c.merged) continue;
      const td = el("td", {
        verticalAlign: c.text?.anchor === "ctr" ? "middle" : c.text?.anchor === "b" ? "bottom" : "top",
        background: c.fill ?? "transparent",
        padding: "0",
        position: "relative",
        borderLeft:
          cellBorder(c.borders.l, k) !== "none" ? cellBorder(c.borders.l, k) : "1px solid rgba(255,255,255,0.9)",
        borderRight:
          cellBorder(c.borders.r, k) !== "none" ? cellBorder(c.borders.r, k) : "1px solid rgba(255,255,255,0.9)",
        borderTop:
          cellBorder(c.borders.t, k) !== "none" ? cellBorder(c.borders.t, k) : "1px solid rgba(255,255,255,0.9)",
        borderBottom:
          cellBorder(c.borders.b, k) !== "none" ? cellBorder(c.borders.b, k) : "1px solid rgba(255,255,255,0.9)",
      });
      if (c.colSpan > 1) td.colSpan = c.colSpan;
      if (c.rowSpan > 1) td.rowSpan = c.rowSpan;
      if (c.text) {
        const inner = el("div", {
          position: "relative",
          padding: `${c.text.inset.t * k}px ${c.text.inset.r * k}px ${c.text.inset.b * k}px ${c.text.inset.l * k}px`,
        });
        const holder = el("div", { position: "relative" });
        inner.appendChild(holder);
        renderTextFlow(c.text, k, holder);
        td.appendChild(inner);
      }
      tr.appendChild(td);
    }
    table.appendChild(tr);
  }
  root.appendChild(table);
  parent.appendChild(root);
}

/** 표 칸처럼 크기가 글에 맞춰지는 곳: 절대 위치 대신 흐름대로 글을 놓는다. */
function renderTextFlow(body: TextBody, k: number, holder: HTMLElement): void {
  renderText({ ...body, inset: { l: 0, t: 0, r: 0, b: 0 } }, k, holder);
  const wrap = holder.querySelector<HTMLElement>(".pp-text");
  if (wrap) {
    wrap.style.position = "static";
    wrap.style.inset = "auto";
  }
}

function renderPlaceholder(s: Extract<Shape, { kind: "placeholder" }>, k: number, parent: HTMLElement): void {
  const root = el("div", {
    border: "1px dashed rgba(120, 120, 120, 0.8)",
    background: "rgba(200, 200, 200, 0.2)",
    color: "rgb(80, 80, 80)",
    font: `${Math.max(10, 12 * k)}px/1.4 ${FALLBACK_FONTS}`,
    padding: `${6 * k}px`,
    boxSizing: "border-box",
    overflow: "hidden",
  });
  place(root, s.box, k);
  root.setAttribute("data-approx", "");
  const head = el("div", { fontWeight: "700", marginBottom: `${3 * k}px` });
  head.textContent = `${s.label} (원본과 다르게 간단히 표시)`;
  root.appendChild(head);
  for (const line of s.lines.slice(0, 40)) {
    const d = el("div");
    d.textContent = line;
    root.appendChild(d);
  }
  parent.appendChild(root);
}

function renderShapes(shapes: Shape[], k: number, opts: RenderOptions, parent: HTMLElement): void {
  for (const s of shapes) {
    switch (s.kind) {
      case "shape":
        renderShape(s, k, opts, parent);
        break;
      case "line":
        renderLine(s, k, parent);
        break;
      case "pic":
        renderPic(s, k, opts, parent);
        break;
      case "table":
        renderTable(s, k, parent);
        break;
      case "placeholder":
        renderPlaceholder(s, k, parent);
        break;
    }
  }
}

/** 슬라이드 하나를 holder 안에 그린다. k 는 pt → 화면 px 배율. */
export function renderSlide(deck: Deck, slide: Slide, k: number, holder: HTMLElement, opts: RenderOptions): void {
  const root = el("div", {
    position: "absolute",
    inset: "0",
    overflow: "hidden",
    background: "#fff",
    ...fillCss(slide.background, opts),
  });
  root.className = "pp-slide";
  // 글자를 고르는 레이어는 슬라이드 전체 하나다. (형광펜은 이 안의 글자 위치로 칠한다)
  root.setAttribute("data-text-layer", "");
  root.style.width = `${deck.width * k}px`;
  root.style.height = `${deck.height * k}px`;
  renderShapes(slide.under, k, opts, root);
  renderShapes(slide.shapes, k, opts, root);
  if (slide.approximate) {
    const note = el("div", {
      position: "absolute",
      left: `${6 * k}px`,
      bottom: `${4 * k}px`,
      font: `${Math.max(9, 10 * k)}px ${FALLBACK_FONTS}`,
      color: "rgb(150, 90, 0)",
      background: "rgba(255, 244, 214, 0.92)",
      padding: "1px 6px",
      borderRadius: "4px",
      userSelect: "none",
      pointerEvents: "none",
    });
    note.textContent = "※ 일부 요소는 원본과 다르게 보일 수 있어요";
    root.appendChild(note);
  }
  holder.replaceChildren(root);
}
