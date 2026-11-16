// .pptx(압축 파일 + XML) 를 읽어 Deck 으로 만든다. 슬라이드 → 레이아웃 → 마스터 → 테마로 이어지는
// 상속(위치, 글자 모양, 색, 글머리표)을 여기서 모두 풀어 둔다.
import { strFromU8, unzipSync } from "fflate";
import type {
  BoxPt,
  Bullet,
  Deck,
  FillSpec,
  GeomSpec,
  LineSpec,
  Para,
  Run,
  Shape,
  Slide,
  Spacing,
  TableCell,
  TextBody,
} from "./model";
import { css, parseTheme, resolveColor, resolveFont, schemeCss, schemeTintCss, type Theme } from "./theme";
import { attr, descendants, kid, kids, name, num, parseXml, path, type El } from "./xml";

const EMU = 12700;
const pt = (emu: number | null | undefined, d = 0) => (emu == null ? d : emu / EMU);
const HANGUL_CJK = /[ㄱ-ㆎ가-힣一-鿿぀-ヿ]/;

// ───────────────────────── 파일 꾸러미(zip) ─────────────────────────

interface Pkg {
  files: Record<string, Uint8Array>;
  xmlCache: Map<string, El | null>;
}

function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function resolvePath(base: string, target: string): string {
  if (/^[a-z]+:/i.test(target)) return target;
  const parts = (target.startsWith("/") ? target.slice(1) : `${dirname(base)}/${target}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}

function loadXml(pkg: Pkg, p: string): El | null {
  if (pkg.xmlCache.has(p)) return pkg.xmlCache.get(p) ?? null;
  const data = pkg.files[p];
  let root: El | null = null;
  if (data) {
    try {
      root = parseXml(strFromU8(data));
    } catch {
      root = null;
    }
  }
  pkg.xmlCache.set(p, root);
  return root;
}

interface Rel {
  id: string;
  type: string;
  target: string;
}

function relsOf(pkg: Pkg, part: string): Map<string, Rel> {
  const out = new Map<string, Rel>();
  const relsPath = `${dirname(part)}/_rels/${part.slice(part.lastIndexOf("/") + 1)}.rels`;
  const root = loadXml(pkg, relsPath);
  for (const r of kids(root, "Relationship")) {
    const id = attr(r, "Id");
    const target = attr(r, "Target");
    if (!id || !target) continue;
    const type = (attr(r, "Type") ?? "").split("/").pop() ?? "";
    out.set(id, { id, type, target: attr(r, "TargetMode") === "External" ? target : resolvePath(part, target) });
  }
  return out;
}

function relOfType(rels: Map<string, Rel>, type: string): Rel | undefined {
  for (const r of rels.values()) if (r.type === type) return r;
  return undefined;
}

// ───────────────────────── 글자·문단 모양(상속) ─────────────────────────

interface RP {
  sz?: number;
  b?: boolean;
  i?: boolean;
  u?: boolean;
  strike?: boolean;
  color?: string;
  latin?: string;
  ea?: string;
  baseline?: number;
}

interface PP {
  algn?: Para["algn"];
  marL?: number;
  indent?: number;
  lnSpc?: Spacing;
  spcBef?: Spacing;
  spcAft?: Spacing;
  buKind?: "none" | "char" | "auto";
  buChar?: string;
  buAuto?: string;
  buColor?: string;
  buSz?: number;
  buFont?: string;
  def: RP;
}

function defined<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {};
  for (const k of Object.keys(o) as Array<keyof T>) if (o[k] !== undefined) out[k] = o[k];
  return out;
}

const mergeRP = (a: RP, b: RP): RP => ({ ...a, ...defined(b) });
const mergePP = (a: PP, b: PP): PP => ({ ...a, ...defined({ ...b, def: undefined }), def: mergeRP(a.def, b.def) });

function readColorOf(parent: El | null, theme: Theme): string | undefined {
  const fill = kid(parent, "solidFill");
  return css(resolveColor(kids(fill)[0], theme));
}

function readRPr(el: El | null, theme: Theme): RP {
  if (!el) return {};
  const b = attr(el, "b");
  const i = attr(el, "i");
  const u = attr(el, "u");
  const strike = attr(el, "strike");
  return defined<RP>({
    sz: num(el, "sz") != null ? (num(el, "sz") as number) / 100 : undefined,
    b: b == null ? undefined : b === "1" || b === "true",
    i: i == null ? undefined : i === "1" || i === "true",
    u: u == null ? undefined : u !== "none",
    strike: strike == null ? undefined : strike !== "noStrike",
    color: readColorOf(el, theme),
    latin: resolveFont(attr(kid(el, "latin"), "typeface"), theme),
    ea: resolveFont(attr(kid(el, "ea"), "typeface"), theme),
    baseline: num(el, "baseline") != null ? (num(el, "baseline") as number) / 1000 : undefined,
  });
}

function readSpacing(el: El | null): Spacing | undefined {
  if (!el) return undefined;
  const pct = num(kid(el, "spcPct"), "val");
  if (pct != null) return { pct: pct / 1000 };
  const pts = num(kid(el, "spcPts"), "val");
  if (pts != null) return { pts: pts / 100 };
  return undefined;
}

function readPPr(el: El | null, theme: Theme): PP {
  if (!el) return { def: {} };
  const out: PP = { def: readRPr(kid(el, "defRPr"), theme) };
  const algn = attr(el, "algn");
  if (algn === "l" || algn === "ctr" || algn === "r" || algn === "just") out.algn = algn;
  else if (algn === "dist" || algn === "justLow") out.algn = "just";
  if (num(el, "marL") != null) out.marL = pt(num(el, "marL"));
  if (num(el, "indent") != null) out.indent = pt(num(el, "indent"));
  out.lnSpc = readSpacing(kid(el, "lnSpc"));
  out.spcBef = readSpacing(kid(el, "spcBef"));
  out.spcAft = readSpacing(kid(el, "spcAft"));
  if (kid(el, "buNone")) out.buKind = "none";
  const ch = kid(el, "buChar");
  if (ch) {
    out.buKind = "char";
    out.buChar = attr(ch, "char") ?? "•";
  }
  const auto = kid(el, "buAutoNum");
  if (auto) {
    out.buKind = "auto";
    out.buAuto = attr(auto, "type") ?? "arabicPeriod";
  }
  const buClr = kid(el, "buClr");
  if (buClr) out.buColor = css(resolveColor(kids(buClr)[0], theme));
  const sz = num(kid(el, "buSzPct"), "val");
  if (sz != null) out.buSz = sz / 1000;
  const font = attr(kid(el, "buFont"), "typeface");
  if (font && !font.startsWith("+")) out.buFont = font;
  return defined(out) as PP & { def: RP };
}

/** 스타일 목록(우선순위 낮은 것부터)에서 그 단계(0~8)의 문단 모양을 합친다. */
function levelPP(chain: Array<El | null>, lvl: number, theme: Theme): PP {
  let acc: PP = { def: {} };
  for (const el of chain) {
    if (!el) continue;
    acc = mergePP(acc, readPPr(kid(el, `lvl${lvl + 1}pPr`), theme));
  }
  return acc;
}

interface TextCtx {
  theme: Theme;
  /** 스타일 목록 (낮은 우선순위 → 높은 우선순위) */
  chain: Array<El | null>;
  defaultColor: string;
  defaultSize: number;
  slideNumber: number;
}

function toBullet(pp: PP): Bullet | undefined {
  if (pp.buKind === "none" || !pp.buKind) return undefined;
  return { char: pp.buChar, auto: pp.buAuto, color: pp.buColor, sizePct: pp.buSz, font: pp.buFont };
}

function readParagraph(p: El, ctx: TextCtx, fontScale: number): Para {
  const pPr = kid(p, "pPr");
  const lvl = Math.min(8, Math.max(0, num(pPr, "lvl") ?? 0));
  const pp = mergePP(levelPP(ctx.chain, lvl, ctx.theme), readPPr(pPr, ctx.theme));
  const runs: Run[] = [];
  const make = (text: string, rPr: El | null, extra: Partial<Run> = {}): Run => {
    const rp = mergeRP(pp.def, readRPr(rPr, ctx.theme));
    const cjk = HANGUL_CJK.test(text);
    const font = (cjk ? (rp.ea ?? rp.latin) : (rp.latin ?? rp.ea)) ?? ctx.theme.minor;
    return {
      text,
      size: (rp.sz ?? ctx.defaultSize) * fontScale,
      bold: rp.b ?? false,
      italic: rp.i ?? false,
      underline: rp.u ?? false,
      strike: rp.strike ?? false,
      color: rp.color ?? ctx.defaultColor,
      font,
      baseline: rp.baseline ?? 0,
      ...extra,
    };
  };
  for (const n of kids(p)) {
    const tag = name(n);
    if (tag === "r")
      runs.push(
        make(
          descendants(n, "t")
            .map((t) => t.textContent ?? "")
            .join(""),
          kid(n, "rPr"),
        ),
      );
    else if (tag === "br") runs.push(make("", kid(n, "rPr"), { br: true }));
    else if (tag === "fld") {
      const isNum = attr(n, "type") === "slidenum";
      runs.push(
        make(
          isNum
            ? String(ctx.slideNumber)
            : descendants(n, "t")
                .map((t) => t.textContent ?? "")
                .join(""),
          kid(n, "rPr"),
          {
            slideNum: isNum,
          },
        ),
      );
    }
  }
  const endSz = readRPr(kid(p, "endParaRPr"), ctx.theme).sz ?? pp.def.sz ?? ctx.defaultSize;
  return {
    runs,
    algn: pp.algn ?? "l",
    marL: pp.marL ?? 0,
    indent: pp.indent ?? 0,
    lvl,
    lnSpc: pp.lnSpc,
    spcBef: pp.spcBef,
    spcAft: pp.spcAft,
    bullet: toBullet(pp),
    endSize: endSz * fontScale,
  };
}

function readTextBody(txBody: El | null, bodyPrChain: Array<El | null>, ctx: TextCtx): TextBody | null {
  if (!txBody) return null;
  const attrs: Record<string, string> = {};
  let autofit: El | null = null;
  for (const bp of [...bodyPrChain, kid(txBody, "bodyPr")]) {
    if (!bp) continue;
    for (const a of Array.from(bp.attributes)) attrs[a.name] = a.value;
    const fit = kid(bp, "normAutofit");
    if (fit) autofit = fit;
    else if (kid(bp, "noAutofit") || kid(bp, "spAutoFit")) autofit = null;
  }
  const fontScale = autofit ? (num(autofit, "fontScale") ?? 100000) / 100000 : 1;
  const lnSpcReduction = autofit ? (num(autofit, "lnSpcReduction") ?? 0) / 100000 : 0;
  const paras = kids(txBody, "p").map((p) => readParagraph(p, ctx, fontScale));
  const anchor = attrs.anchor === "ctr" ? "ctr" : attrs.anchor === "b" ? "b" : "t";
  const e = (k: string, d: number) => pt(attrs[k] != null ? Number(attrs[k]) : null, d / EMU);
  return {
    paras,
    anchor,
    inset: { l: e("lIns", 91440), t: e("tIns", 45720), r: e("rIns", 91440), b: e("bIns", 45720) },
    wrap: attrs.wrap !== "none",
    fontScale,
    lnSpcReduction,
  };
}

const paraText = (p: Para) => p.runs.map((r) => (r.br ? "\n" : r.text)).join("");
const bodyText = (t: TextBody | null) =>
  t
    ? t.paras
        .map(paraText)
        .filter((s) => s.trim())
        .join("\n")
    : "";

// ───────────────────────── 채우기·선·도형 모양 ─────────────────────────

function gradientCss(grad: El, theme: Theme): string | null {
  const stops = kids(kid(grad, "gsLst"), "gs")
    .map((gs) => {
      const c = css(resolveColor(kids(gs)[0], theme));
      const pos = (num(gs, "pos") ?? 0) / 1000;
      return c ? `${c} ${pos}%` : null;
    })
    .filter((x): x is string => !!x);
  if (stops.length === 0) return null;
  if (stops.length === 1) return stops[0].split(" ")[0] + "";
  if (kid(grad, "path")) return `radial-gradient(circle, ${stops.join(", ")})`;
  const ang = ((num(kid(grad, "lin"), "ang") ?? 0) / 60000 + 90) % 360;
  return `linear-gradient(${ang}deg, ${stops.join(", ")})`;
}

const MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  bmp: "image/bmp",
};

export function mimeOf(p: string): string | null {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase();
  return MIME[ext] ?? null;
}

interface PartCtx {
  pkg: Pkg;
  part: string;
  rels: Map<string, Rel>;
  theme: Theme;
  used: Map<string, Uint8Array>;
}

function readFill(holder: El | null, c: PartCtx): FillSpec | null | undefined {
  // undefined: 지정 안 됨(상속/스타일), null: 채우지 않음
  for (const k of kids(holder)) {
    const tag = name(k);
    if (tag === "noFill") return null;
    if (tag === "solidFill") {
      const v = css(resolveColor(kids(k)[0], c.theme));
      return v ? { type: "solid", css: v } : undefined;
    }
    if (tag === "gradFill") {
      const g = gradientCss(k, c.theme);
      return g ? { type: "grad", css: g } : undefined;
    }
    if (tag === "blipFill") {
      const id = attr(kid(k, "blip"), "r:embed");
      const rel = id ? c.rels.get(id) : undefined;
      const mime = rel ? mimeOf(rel.target) : null;
      if (rel && mime && c.pkg.files[rel.target]) {
        c.used.set(rel.target, c.pkg.files[rel.target]);
        return { type: "pic", media: rel.target, mime };
      }
      return undefined;
    }
  }
  return undefined;
}

function readLine(spPr: El | null, c: PartCtx): LineSpec | null | undefined {
  const ln = kid(spPr, "ln");
  if (!ln) return undefined;
  if (kid(ln, "noFill")) return null;
  const color = readColorOf(ln, c.theme);
  const dash = attr(kid(ln, "prstDash"), "val");
  const head = attr(kid(ln, "headEnd"), "type");
  const tail = attr(kid(ln, "tailEnd"), "type");
  if (!color && !kid(ln, "solidFill") && num(ln, "w") == null && !kid(ln, "gradFill")) return undefined;
  return {
    css: color ?? "rgb(0, 0, 0)",
    w: pt(num(ln, "w"), 0.75),
    dash: dash === "dot" || dash === "sysDot" ? "dot" : dash && dash !== "solid" ? "dash" : undefined,
    head: !!head && head !== "none",
    tail: !!tail && tail !== "none",
  };
}

const POLY: Record<string, Array<[number, number]>> = {
  triangle: [
    [0.5, 0],
    [1, 1],
    [0, 1],
  ],
  rtTriangle: [
    [0, 0],
    [1, 1],
    [0, 1],
  ],
  diamond: [
    [0.5, 0],
    [1, 0.5],
    [0.5, 1],
    [0, 0.5],
  ],
  rightArrow: [
    [0, 0.25],
    [0.6, 0.25],
    [0.6, 0],
    [1, 0.5],
    [0.6, 1],
    [0.6, 0.75],
    [0, 0.75],
  ],
  leftArrow: [
    [1, 0.25],
    [0.4, 0.25],
    [0.4, 0],
    [0, 0.5],
    [0.4, 1],
    [0.4, 0.75],
    [1, 0.75],
  ],
  upArrow: [
    [0.25, 1],
    [0.25, 0.4],
    [0, 0.4],
    [0.5, 0],
    [1, 0.4],
    [0.75, 0.4],
    [0.75, 1],
  ],
  downArrow: [
    [0.25, 0],
    [0.25, 0.6],
    [0, 0.6],
    [0.5, 1],
    [1, 0.6],
    [0.75, 0.6],
    [0.75, 0],
  ],
  homePlate: [
    [0, 0],
    [0.8, 0],
    [1, 0.5],
    [0.8, 1],
    [0, 1],
  ],
  chevron: [
    [0, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0, 1],
    [0.25, 0.5],
  ],
  hexagon: [
    [0.25, 0],
    [0.75, 0],
    [1, 0.5],
    [0.75, 1],
    [0.25, 1],
    [0, 0.5],
  ],
  parallelogram: [
    [0.25, 0],
    [1, 0],
    [0.75, 1],
    [0, 1],
  ],
  trapezoid: [
    [0.2, 0],
    [0.8, 0],
    [1, 1],
    [0, 1],
  ],
  octagon: [
    [0.3, 0],
    [0.7, 0],
    [1, 0.3],
    [1, 0.7],
    [0.7, 1],
    [0.3, 1],
    [0, 0.7],
    [0, 0.3],
  ],
};

const LINE_PRESETS = /^(line|straightConnector1|bentConnector\d|curvedConnector\d)$/;

interface GeomResult {
  geom: GeomSpec;
  approximate: boolean;
}

function readGeom(spPr: El | null): GeomResult {
  const prst = kid(spPr, "prstGeom");
  if (prst) {
    const p = attr(prst, "prst") ?? "rect";
    if (LINE_PRESETS.test(p)) return { geom: { kind: "line" }, approximate: /bent|curved/.test(p) };
    if (p === "ellipse") return { geom: { kind: "ellipse" }, approximate: false };
    if (p === "roundRect") {
      const gd = kids(kid(prst, "avLst"), "gd").find((g) => attr(g, "name") === "adj");
      const v = Number((attr(gd, "fmla") ?? "val 16667").replace("val", "").trim());
      return {
        geom: { kind: "roundRect", radius: Math.min(0.5, Math.max(0, (Number.isFinite(v) ? v : 16667) / 100000)) },
        approximate: false,
      };
    }
    const adj = (n: string, d: number) => {
      const gd = kids(kid(prst, "avLst"), "gd").find((g) => attr(g, "name") === n);
      const v = Number((attr(gd, "fmla") ?? "").replace("val", "").trim());
      return (Number.isFinite(v) && attr(gd, "fmla") ? v : d) / 100000;
    };
    const arrow = /^(right|left|up|down)Arrow$/.exec(p);
    if (arrow)
      return {
        geom: { kind: "arrow", dir: arrow[1] as "right", shaft: adj("adj1", 50000), head: adj("adj2", 50000) },
        approximate: false,
      };
    if (p === "homePlate" || p === "chevron")
      return { geom: { kind: "chevron", home: p === "homePlate", depth: adj("adj", 50000) }, approximate: false };
    if (POLY[p]) return { geom: { kind: "poly", points: POLY[p] }, approximate: false };
    return { geom: { kind: "rect" }, approximate: !/^(rect|flowChartProcess|snip\w*|round\w*)$/.test(p) };
  }
  const cust = kid(spPr, "custGeom");
  if (cust) {
    let d = "";
    let w = 0;
    let h = 0;
    let approximate = false;
    for (const pth of kids(kid(cust, "pathLst"), "path")) {
      w = Math.max(w, num(pth, "w") ?? 0);
      h = Math.max(h, num(pth, "h") ?? 0);
      const P = (e: El) => `${attr(e, "x") ?? 0} ${attr(e, "y") ?? 0}`;
      for (const cmd of kids(pth)) {
        const pts = kids(cmd, "pt");
        switch (name(cmd)) {
          case "moveTo":
            d += `M${P(pts[0])} `;
            break;
          case "lnTo":
            d += `L${P(pts[0])} `;
            break;
          case "cubicBezTo":
            d += `C${pts.map(P).join(" ")} `;
            break;
          case "quadBezTo":
            d += `Q${pts.map(P).join(" ")} `;
            break;
          case "close":
            d += "Z ";
            break;
          default:
            approximate = true; // arcTo 등
        }
      }
    }
    if (d && w > 0 && h > 0) return { geom: { kind: "path", w, h, d: d.trim() }, approximate };
  }
  return { geom: { kind: "rect" }, approximate: false };
}

// ───────────────────────── 위치·변환 ─────────────────────────

interface Xf {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}
const IDENTITY: Xf = { tx: 0, ty: 0, sx: 1, sy: 1 };

function readBox(xfrm: El | null, T: Xf): BoxPt | null {
  if (!xfrm) return null;
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  if (!off || !ext) return null;
  const x = num(off, "x") ?? 0;
  const y = num(off, "y") ?? 0;
  const cx = num(ext, "cx") ?? 0;
  const cy = num(ext, "cy") ?? 0;
  return {
    x: pt(T.tx + x * T.sx),
    y: pt(T.ty + y * T.sy),
    w: pt(cx * T.sx),
    h: pt(cy * T.sy),
    rot: (num(xfrm, "rot") ?? 0) / 60000,
    flipH: attr(xfrm, "flipH") === "1",
    flipV: attr(xfrm, "flipV") === "1",
  };
}

function groupXf(grp: El, T: Xf): Xf {
  const xfrm = path(grp, "grpSpPr/xfrm");
  const off = kid(xfrm, "off");
  const ext = kid(xfrm, "ext");
  const chOff = kid(xfrm, "chOff");
  const chExt = kid(xfrm, "chExt");
  if (!off || !ext || !chOff || !chExt) return T;
  const rx = (num(chExt, "cx") ?? 0) ? (num(ext, "cx") ?? 0) / (num(chExt, "cx") as number) : 1;
  const ry = (num(chExt, "cy") ?? 0) ? (num(ext, "cy") ?? 0) / (num(chExt, "cy") as number) : 1;
  return {
    tx: T.tx + T.sx * ((num(off, "x") ?? 0) - (num(chOff, "x") ?? 0) * rx),
    ty: T.ty + T.sy * ((num(off, "y") ?? 0) - (num(chOff, "y") ?? 0) * ry),
    sx: T.sx * rx,
    sy: T.sy * ry,
  };
}

// ───────────────────────── 마스터·레이아웃 ─────────────────────────

interface Master {
  part: string;
  root: El;
  theme: Theme;
  txStyles: El | null;
  phShapes: El[];
}
interface Layout {
  part: string;
  root: El;
  master: Master;
  phShapes: El[];
}

function phOf(sp: El): El | null {
  return path(sp, "nvSpPr/nvPr/ph");
}

function spShapes(root: El): El[] {
  return descendants(path(root, "cSld/spTree"), "sp").filter((sp) => phOf(sp));
}

function loadMaster(pkg: Pkg, part: string): Master | null {
  const root = loadXml(pkg, part);
  if (!root) return null;
  const rels = relsOf(pkg, part);
  const themeRel = relOfType(rels, "theme");
  const theme = parseTheme(themeRel ? loadXml(pkg, themeRel.target) : null, root);
  return { part, root, theme, txStyles: kid(root, "txStyles"), phShapes: spShapes(root) };
}

type PhKind = "title" | "body" | "dt" | "ftr" | "sldNum";
function phKind(ph: El): PhKind {
  const t = attr(ph, "type");
  if (t === "title" || t === "ctrTitle") return "title";
  if (t === "dt" || t === "ftr" || t === "sldNum") return t;
  return "body";
}

function matchLayoutPh(layout: Layout | null, ph: El): El | null {
  if (!layout) return null;
  const idx = attr(ph, "idx");
  const type = attr(ph, "type");
  const list = layout.phShapes;
  const byIdx = idx != null ? list.find((sp) => attr(phOf(sp), "idx") === idx) : undefined;
  if (byIdx) return byIdx;
  const byType = type ? list.find((sp) => attr(phOf(sp), "type") === type) : undefined;
  if (byType) return byType;
  return list.find((sp) => phKind(phOf(sp) as El) === phKind(ph)) ?? null;
}

function matchMasterPh(master: Master, ph: El): El | null {
  const k = phKind(ph);
  return master.phShapes.find((sp) => phKind(phOf(sp) as El) === k) ?? null;
}

// ───────────────────────── 도형 읽기 ─────────────────────────

interface SlideEnv {
  pkg: Pkg;
  master: Master;
  layout: Layout | null;
  defaultTextStyle: El | null;
  slideNumber: number;
  /** 도형을 읽는 파트(슬라이드/레이아웃/마스터)의 관계·테마 */
  part: PartCtx;
  /** true 면 자리 표시자(placeholder)는 건너뛴다 (마스터·레이아웃의 장식을 읽을 때) */
  skipPh: boolean;
  approximate: { v: boolean };
}

function styleRef(sp: El, which: "fillRef" | "lnRef" | "fontRef", theme: Theme): { idx: number; css?: string } | null {
  const ref = path(sp, `style/${which}`);
  if (!ref) return null;
  return { idx: num(ref, "idx") ?? 0, css: css(resolveColor(kids(ref)[0], theme)) };
}

function readShape(sp: El, T: Xf, env: SlideEnv, out: Shape[]): void {
  if (attr(path(sp, "nvSpPr/cNvPr"), "hidden") === "1") return;
  const ph = phOf(sp);
  if (ph && env.skipPh) return;
  const c = env.part;
  const spPr = kid(sp, "spPr");
  const layoutSp = ph ? matchLayoutPh(env.layout, ph) : null;
  const masterSp = ph ? matchMasterPh(env.master, ph) : null;

  let xfrm = kid(spPr, "xfrm");
  if (!xfrm && ph) xfrm = kid(kid(layoutSp, "spPr"), "xfrm") ?? kid(kid(masterSp, "spPr"), "xfrm");
  const box = readBox(xfrm, T);
  if (!box) return;

  const { geom, approximate } = readGeom(spPr);
  if (approximate) env.approximate.v = true;

  let fill = readFill(spPr, c);
  let line = readLine(spPr, c);
  const fillRef = styleRef(sp, "fillRef", c.theme);
  const lnRef = styleRef(sp, "lnRef", c.theme);
  if (fill === undefined) {
    const inherited = ph ? (readFill(kid(layoutSp, "spPr"), c) ?? readFill(kid(masterSp, "spPr"), c)) : undefined;
    fill =
      inherited !== undefined
        ? inherited
        : fillRef && fillRef.idx > 0 && fillRef.css
          ? { type: "solid", css: fillRef.css }
          : null;
  }
  if (line === undefined) {
    line = lnRef && lnRef.idx > 0 && lnRef.css ? { css: lnRef.css, w: 1 } : null;
  }

  if (geom.kind === "line") {
    out.push({ kind: "line", box, line: line ?? { css: lnRef?.css ?? "rgb(0, 0, 0)", w: 1 } });
    return;
  }

  // 글자
  let text: TextBody | null = null;
  const txBody = kid(sp, "txBody");
  if (txBody) {
    const kind = ph ? phKind(ph) : null;
    const master = env.master;
    const styleKey = kind === "title" ? "titleStyle" : kind === "body" ? "bodyStyle" : "otherStyle";
    const chain: Array<El | null> = [env.defaultTextStyle];
    if (ph)
      chain.push(
        kid(master.txStyles, styleKey),
        kid(kid(masterSp, "txBody"), "lstStyle"),
        kid(kid(layoutSp, "txBody"), "lstStyle"),
      );
    chain.push(kid(txBody, "lstStyle"));
    const fontRef = styleRef(sp, "fontRef", c.theme);
    const defaultColor = (ph ? undefined : fontRef?.css) ?? schemeCss(c.theme, "tx1") ?? "rgb(0, 0, 0)";
    const ctx: TextCtx = { theme: c.theme, chain, defaultColor, defaultSize: 18, slideNumber: env.slideNumber };
    text = readTextBody(
      txBody,
      ph
        ? [kid(masterSp, "txBody") && kid(kid(masterSp, "txBody"), "bodyPr"), kid(kid(layoutSp, "txBody"), "bodyPr")]
        : [],
      ctx,
    );
  }
  out.push({ kind: "shape", box, geom, fill, line, text, isTitle: ph ? phKind(ph) === "title" : false });
}

function readPic(pic: El, T: Xf, env: SlideEnv, out: Shape[]): void {
  if (attr(path(pic, "nvPicPr/cNvPr"), "hidden") === "1") return;
  const box = readBox(kid(kid(pic, "spPr"), "xfrm"), T);
  if (!box) return;
  const id = attr(kid(kid(pic, "blipFill"), "blip"), "r:embed");
  const rel = id ? env.part.rels.get(id) : undefined;
  const mime = rel ? mimeOf(rel.target) : null;
  const src = kid(kid(pic, "blipFill"), "srcRect");
  const crop = src
    ? {
        l: (num(src, "l") ?? 0) / 100000,
        t: (num(src, "t") ?? 0) / 100000,
        r: (num(src, "r") ?? 0) / 100000,
        b: (num(src, "b") ?? 0) / 100000,
      }
    : undefined;
  const ok = !!(rel && mime && env.part.pkg.files[rel.target]);
  if (ok && rel) env.part.used.set(rel.target, env.part.pkg.files[rel.target]);
  else env.approximate.v = true;
  out.push({
    kind: "pic",
    box,
    media: ok && rel ? rel.target : null,
    mime: mime ?? "",
    crop,
    alt: attr(path(pic, "nvPicPr/cNvPr"), "descr") ?? "",
  });
}

const NO_STYLE_TABLES = new Set(["{2D5ABB26-0587-4C30-8999-92F81FD0307C}", "{5940675A-B579-460E-94D1-54222C63F5DA}"]);

function readTable(tbl: El, box: BoxPt, env: SlideEnv, out: Shape[]): void {
  const c = env.part;
  const grid = kids(kid(tbl, "tblGrid"), "gridCol").map((g) => pt(num(g, "w")));
  const tblPr = kid(tbl, "tblPr");
  const styleId = textOf(kid(tblPr, "tableStyleId"));
  const styled = !NO_STYLE_TABLES.has(styleId) && !!styleId;
  const firstRow = attr(tblPr, "firstRow") === "1";
  const bandRow = attr(tblPr, "bandRow") === "1";
  const accent = schemeCss(c.theme, "accent1");
  const white = "rgb(255, 255, 255)";
  const rows = kids(tbl, "tr").map((tr, ri) => {
    const cells: TableCell[] = kids(tr, "tc").map((tc) => {
      const tcPr = kid(tc, "tcPr");
      let fill: string | null = null;
      const explicit = readFill(tcPr, c);
      if (explicit && explicit.type === "solid") fill = explicit.css;
      else if (explicit === undefined && styled) {
        if (firstRow && ri === 0) fill = accent ?? null;
        else if (bandRow) fill = schemeTintCss(c.theme, "accent1", ri % 2 === 1 ? 0.4 : 0.2) ?? null;
      }
      const header = styled && firstRow && ri === 0 && explicit === undefined;
      const ctx: TextCtx = {
        theme: c.theme,
        chain: [env.defaultTextStyle],
        defaultColor: header ? white : (schemeCss(c.theme, "tx1") ?? "rgb(0, 0, 0)"),
        defaultSize: 18,
        slideNumber: env.slideNumber,
      };
      const body = readTextBody(kid(tc, "txBody"), [], ctx);
      if (header && body) {
        for (const p of body.paras) {
          for (const r of p.runs) {
            r.bold = true;
            r.color = white;
          }
        }
      }
      const border = (tag: string) => {
        const ln = kid(tcPr, tag);
        if (!ln) return undefined;
        if (kid(ln, "noFill")) return undefined;
        const color = readColorOf(ln, c.theme);
        return color ? { css: color, w: pt(num(ln, "w"), 0.75) } : undefined;
      };
      return {
        text: body,
        fill,
        colSpan: num(tc, "gridSpan") ?? 1,
        rowSpan: num(tc, "rowSpan") ?? 1,
        merged: attr(tc, "hMerge") === "1" || attr(tc, "vMerge") === "1",
        borders: { l: border("lnL"), t: border("lnT"), r: border("lnR"), b: border("lnB") },
      };
    });
    return { h: pt(num(tr, "h")), cells };
  });
  out.push({ kind: "table", box, cols: grid, rows });
}

const textOf = (el: El | null) => el?.textContent?.trim() ?? "";

function readFrame(frame: El, T: Xf, env: SlideEnv, out: Shape[]): void {
  if (attr(path(frame, "nvGraphicFramePr/cNvPr"), "hidden") === "1") return;
  const box = readBox(kid(frame, "xfrm"), T);
  if (!box) return;
  const data = path(frame, "graphic/graphicData");
  const tbl = kid(data, "tbl");
  if (tbl) return readTable(tbl, box, env, out);

  env.approximate.v = true;
  const rels = env.part.rels;
  let label = "개체";
  let lines: string[] = [];
  const rel = (id: string | null) => (id ? rels.get(id) : undefined);

  const chart = kid(data, "chart");
  const dgm = kid(data, "relIds");
  if (chart) {
    label = "차트";
    const r = rel(attr(chart, "r:id"));
    const root = r ? loadXml(env.part.pkg, r.target) : null;
    if (root) {
      const title = descendants(kid(root, "chart") && path(root, "chart/title"), "t")
        .map((t) => t.textContent ?? "")
        .join("");
      const series = descendants(root, "ser")
        .map((s) =>
          descendants(kid(s, "tx"), "v")
            .map((v) => v.textContent ?? "")
            .join(" "),
        )
        .filter(Boolean);
      const cats = descendants(kid(descendants(root, "ser")[0] ?? null, "cat"), "v")
        .map((v) => v.textContent ?? "")
        .filter(Boolean);
      lines = [
        title,
        series.length ? `계열: ${series.join(", ")}` : "",
        cats.length ? `항목: ${cats.join(", ")}` : "",
      ].filter(Boolean);
    }
  } else if (dgm) {
    label = "SmartArt";
    const r = rel(attr(dgm, "r:dm"));
    const root = r ? loadXml(env.part.pkg, r.target) : null;
    if (root) {
      lines = descendants(kid(root, "ptLst"), "pt")
        .filter((pt2) => {
          const t = attr(pt2, "type");
          return !t || t === "node";
        })
        .map((pt2) =>
          descendants(pt2, "t")
            .map((t) => t.textContent ?? "")
            .join(""),
        )
        .filter((s) => s.trim());
    }
  } else if (kid(data, "oleObj")) {
    label = "삽입된 개체";
  }
  out.push({ kind: "placeholder", box, label, lines });
}

function readTree(tree: El | null, T: Xf, env: SlideEnv, out: Shape[]): void {
  for (const n of kids(tree)) {
    switch (name(n)) {
      case "sp":
      case "cxnSp":
        readShape(n, T, env, out);
        break;
      case "pic":
        readPic(n, T, env, out);
        break;
      case "grpSp":
        if (attr(path(n, "nvGrpSpPr/cNvPr"), "hidden") !== "1") readTree(n, groupXf(n, T), env, out);
        break;
      case "graphicFrame":
        readFrame(n, T, env, out);
        break;
      default:
    }
  }
}

// ───────────────────────── 글 추출 ─────────────────────────

function shapeTexts(shapes: Shape[]): string[] {
  const out: string[] = [];
  const titles: string[] = [];
  for (const s of shapes) {
    if (s.kind === "shape") {
      const t = bodyText(s.text);
      if (!t) continue;
      (s.isTitle ? titles : out).push(t);
    } else if (s.kind === "table") {
      for (const row of s.rows) {
        const cells = row.cells.filter((c) => !c.merged).map((c) => bodyText(c.text).replace(/\n/g, " "));
        if (cells.some((c) => c.trim())) out.push(cells.join(" | "));
      }
    } else if (s.kind === "placeholder") {
      const body = s.lines.filter(Boolean).join("\n");
      if (body) out.push(`[${s.label}]\n${body}`);
    } else if (s.kind === "pic" && s.alt.trim()) {
      out.push(`[그림: ${s.alt.trim()}]`);
    }
  }
  return [...titles, ...out];
}

// ───────────────────────── 전체 ─────────────────────────

function readBackground(root: El | null, c: PartCtx): FillSpec | null | undefined {
  const bg = path(root, "cSld/bg");
  if (!bg) return undefined;
  const pr = kid(bg, "bgPr");
  if (pr) return readFill(pr, c);
  const ref = kid(bg, "bgRef");
  const color = css(resolveColor(kids(ref)[0], c.theme));
  return color ? { type: "solid", css: color } : undefined;
}

function notesText(pkg: Pkg, rels: Map<string, Rel>): string {
  const rel = relOfType(rels, "notesSlide");
  const root = rel ? loadXml(pkg, rel.target) : null;
  if (!root) return "";
  const paras: string[] = [];
  for (const sp of descendants(path(root, "cSld/spTree"), "sp")) {
    if (attr(phOf(sp), "type") !== "body") continue;
    for (const p of kids(kid(sp, "txBody"), "p")) {
      const t = descendants(p, "t")
        .map((x) => x.textContent ?? "")
        .join("");
      if (t.trim()) paras.push(t);
    }
  }
  return paras.join("\n");
}

/** 지원하지 않는 파일이면 사용자가 읽을 수 있는 오류를 던진다. */
export function parsePptx(buffer: ArrayBuffer): Deck {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error(
      "PowerPoint(.pptx) 파일이 아니거나 손상된 파일입니다. (옛 .ppt 형식은 .pptx 로 저장해서 열어 주세요)",
    );
  }
  const pkg: Pkg = { files, xmlCache: new Map() };
  const presPart = "ppt/presentation.xml";
  const pres = loadXml(pkg, presPart);
  if (!pres) throw new Error("PowerPoint(.pptx) 파일이 아니거나 손상된 파일입니다.");
  const presRels = relsOf(pkg, presPart);
  const sz = kid(pres, "sldSz");
  const width = pt(num(sz, "cx"), 960);
  const height = pt(num(sz, "cy"), 540);
  const defaultTextStyle = kid(pres, "defaultTextStyle");

  const masters = new Map<string, Master | null>();
  const layouts = new Map<string, Layout | null>();
  const getMaster = (p: string) => {
    if (!masters.has(p)) masters.set(p, loadMaster(pkg, p));
    return masters.get(p) ?? null;
  };
  const getLayout = (p: string): Layout | null => {
    if (layouts.has(p)) return layouts.get(p) ?? null;
    const root = loadXml(pkg, p);
    const mRel = relOfType(relsOf(pkg, p), "slideMaster");
    const master = mRel ? getMaster(mRel.target) : null;
    const lay = root && master ? { part: p, root, master, phShapes: spShapes(root) } : null;
    layouts.set(p, lay);
    return lay;
  };

  const media = new Map<string, Uint8Array>();
  const decorCache = new Map<string, Shape[]>();
  const slides: Slide[] = [];
  const ids = kids(kid(pres, "sldIdLst"), "sldId");

  ids.forEach((sldId, i) => {
    const rel = presRels.get(attr(sldId, "r:id") ?? "");
    if (!rel) return;
    const root = loadXml(pkg, rel.target);
    if (!root) return;
    const rels = relsOf(pkg, rel.target);
    const layRel = relOfType(rels, "slideLayout");
    const layout = layRel ? getLayout(layRel.target) : null;
    const master =
      layout?.master ??
      (() => {
        const first = [...presRels.values()].find((r) => r.type === "slideMaster");
        return first ? getMaster(first.target) : null;
      })();
    if (!master) return;

    const approximate = { v: false };
    const slidePart: PartCtx = { pkg, part: rel.target, rels, theme: master.theme, used: media };
    const env: SlideEnv = {
      pkg,
      master,
      layout,
      defaultTextStyle,
      slideNumber: i + 1,
      part: slidePart,
      skipPh: false,
      approximate,
    };

    // 마스터·레이아웃의 장식(로고, 선 …)은 한 번만 읽어 재사용
    const underFor = (p: Master | Layout): Shape[] => {
      const key = p.part;
      if (decorCache.has(key)) return decorCache.get(key) as Shape[];
      const shapes: Shape[] = [];
      const partRels = relsOf(pkg, p.part);
      const ctx: PartCtx = { pkg, part: p.part, rels: partRels, theme: master.theme, used: media };
      const e: SlideEnv = { ...env, part: ctx, skipPh: true, approximate: { v: false } };
      readTree(path(p.root, "cSld/spTree"), IDENTITY, e, shapes);
      decorCache.set(key, shapes);
      return shapes;
    };
    const under: Shape[] = [];
    const showMasterSp = layout ? attr(layout.root, "showMasterSp") !== "0" : true;
    if (showMasterSp) under.push(...underFor(master));
    if (layout) under.push(...underFor(layout));

    const shapes: Shape[] = [];
    readTree(path(root, "cSld/spTree"), IDENTITY, env, shapes);

    const bg =
      readBackground(root, slidePart) ??
      (layout
        ? readBackground(layout.root, { ...slidePart, part: layout.part, rels: relsOf(pkg, layout.part) })
        : undefined) ??
      readBackground(master.root, { ...slidePart, part: master.part, rels: relsOf(pkg, master.part) }) ??
      null;

    const body = shapeTexts(shapes).join("\n");
    const notes = notesText(pkg, rels);
    slides.push({
      number: i + 1,
      background: bg,
      under,
      shapes,
      text: [body, notes ? `[발표자 노트]\n${notes}` : ""].filter(Boolean).join("\n\n").trim(),
      approximate: approximate.v,
    });
  });

  if (slides.length === 0) throw new Error("슬라이드를 찾지 못했습니다.");
  return { width, height, slides, media };
}
