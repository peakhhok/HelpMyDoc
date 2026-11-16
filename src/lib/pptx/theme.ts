// 테마 색·글꼴과 색 변환(밝기, 투명도 등)
import { attr, kid, kids, name, num, path, type El } from "./xml";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Theme {
  /** dk1, lt1, accent1 … → "rrggbb" */
  colors: Record<string, string>;
  /** 슬라이드 마스터의 색 별칭: tx1 → dk1, bg1 → lt1 … */
  clrMap: Record<string, string>;
  major: string;
  minor: string;
}

const PRESET: Record<string, string> = {
  black: "000000",
  white: "ffffff",
  red: "ff0000",
  green: "008000",
  blue: "0000ff",
  yellow: "ffff00",
  gray: "808080",
  grey: "808080",
  orange: "ffa500",
  lightgray: "d3d3d3",
  darkgray: "a9a9a9",
};

export function parseTheme(themeRoot: El | null, masterRoot: El | null): Theme {
  const colors: Record<string, string> = {};
  const scheme = path(themeRoot, "themeElements/clrScheme");
  for (const c of kids(scheme)) {
    const inner = kids(c)[0];
    if (!inner) continue;
    colors[name(c)] = (attr(inner, "lastClr") ?? attr(inner, "val") ?? "000000").toLowerCase();
  }
  const clrMap: Record<string, string> = {};
  const m = kid(masterRoot, "clrMap");
  if (m) for (const a of Array.from(m.attributes)) clrMap[a.name] = a.value;
  const fonts = path(themeRoot, "themeElements/fontScheme");
  return {
    colors,
    clrMap: Object.keys(clrMap).length
      ? clrMap
      : { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", accent1: "accent1" },
    major: attr(path(fonts, "majorFont/latin"), "typeface") ?? "",
    minor: attr(path(fonts, "minorFont/latin"), "typeface") ?? "",
  };
}

function hex(h: string): Rgba {
  const v = h.length === 3 ? h.replace(/(.)/g, "$1$1") : h.padEnd(6, "0");
  return { r: parseInt(v.slice(0, 2), 16), g: parseInt(v.slice(2, 4), 16), b: parseInt(v.slice(4, 6), 16), a: 1 };
}

function toHsl({ r, g, b }: Rgba): [number, number, number] {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number, a: number): Rgba {
  const f = (p: number, q: number, t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v, a };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(f(p, q, h + 1 / 3) * 255),
    g: Math.round(f(p, q, h) * 255),
    b: Math.round(f(p, q, h - 1 / 3) * 255),
    a,
  };
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const toLinear = (v: number) => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (x: number) =>
  Math.round(255 * clamp01(x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055));

/** 색을 amount 만큼 남기고 나머지를 target(1=흰색, 0=검정)으로 섞는다. 파워포인트처럼 빛의 세기(선형) 공간에서 섞는다. */
function mixLinear(c: Rgba, amount: number, target: 0 | 1): Rgba {
  const f = (v: number) => fromLinear(toLinear(v) * amount + target * (1 - amount));
  return { r: f(c.r), g: f(c.g), b: f(c.b), a: c.a };
}

/** 테마 색을 밝게(tint) 섞은 CSS 색 */
export function schemeTintCss(theme: Theme, val: string, tint: number): string | undefined {
  const found = theme.colors[theme.clrMap[val] ?? val];
  return found ? css(mixLinear(hex(found), tint, 1)) : undefined;
}

/** a:solidFill 같은 색 요소의 자식(srgbClr, schemeClr …) 하나를 색으로 바꾼다. */
export function resolveColor(colorEl: El | null | undefined, theme: Theme): Rgba | null {
  if (!colorEl) return null;
  const kind = name(colorEl);
  const val = attr(colorEl, "val");
  let base: Rgba | null = null;
  if (kind === "srgbClr" && val) base = hex(val.toLowerCase());
  else if (kind === "sysClr")
    base = hex((attr(colorEl, "lastClr") ?? (val === "window" ? "ffffff" : "000000")).toLowerCase());
  else if (kind === "prstClr" && val) base = hex(PRESET[val] ?? "000000");
  else if (kind === "schemeClr" && val) {
    const key = theme.clrMap[val] ?? val;
    const found = theme.colors[key] ?? theme.colors[val];
    if (val === "phClr") return null;
    base = found ? hex(found) : null;
  }
  if (!base) return null;
  let c = base;
  for (const t of kids(colorEl)) {
    const v = (num(t, "val") ?? 100000) / 100000;
    switch (name(t)) {
      case "alpha":
        c = { ...c, a: clamp01(v) };
        break;
      case "lumMod": {
        const [h, s, l] = toHsl(c);
        c = fromHsl(h, s, clamp01(l * v), c.a);
        break;
      }
      case "lumOff": {
        const [h, s, l] = toHsl(c);
        c = fromHsl(h, s, clamp01(l + v), c.a);
        break;
      }
      case "satMod": {
        const [h, s, l] = toHsl(c);
        c = fromHsl(h, clamp01(s * v), l, c.a);
        break;
      }
      case "tint":
        c = mixLinear(c, v, 1);
        break;
      case "shade":
        c = mixLinear(c, v, 0);
        break;
      default:
    }
  }
  return c;
}

/** 테마 색 이름(tx1, accent1 …)을 CSS 색으로 */
export function schemeCss(theme: Theme, val: string): string | undefined {
  const found = theme.colors[theme.clrMap[val] ?? val];
  return found ? css(hex(found)) : undefined;
}

export function css(c: Rgba | null | undefined): string | undefined {
  if (!c) return undefined;
  return c.a >= 0.999
    ? `rgb(${c.r}, ${c.g}, ${c.b})`
    : `rgba(${c.r}, ${c.g}, ${c.b}, ${Math.round(c.a * 1000) / 1000})`;
}

/** +mj-lt / +mn-lt 같은 테마 글꼴 이름을 실제 이름으로 */
export function resolveFont(face: string | null | undefined, theme: Theme): string | undefined {
  if (!face) return undefined;
  if (face === "+mj-lt" || face === "+mj-ea") return theme.major || undefined;
  if (face === "+mn-lt" || face === "+mn-ea") return theme.minor || undefined;
  if (face.startsWith("+")) return undefined;
  return face;
}
