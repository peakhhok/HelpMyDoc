// 형광펜과 메모. 위치는 페이지 크기에 대한 비율(0~1)로 저장하므로 확대·축소해도 그대로 맞는다.

export const HL_COLORS = ["yellow", "green", "pink", "blue"] as const;
export type HlColor = (typeof HL_COLORS)[number];

export const HL_CSS: Record<HlColor, string> = {
  yellow: "rgba(255, 224, 0, 0.55)",
  green: "rgba(92, 214, 92, 0.5)",
  pink: "rgba(255, 105, 160, 0.45)",
  blue: "rgba(80, 170, 255, 0.45)",
};

export const HL_LABEL: Record<HlColor, string> = { yellow: "노랑", green: "초록", pink: "분홍", blue: "파랑" };

/** 페이지 크기에 대한 비율 (0~1) */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Highlight {
  id: string;
  page: number;
  color: HlColor;
  rects: Rect[];
  /** 표시한 글자 */
  text: string;
  /** 이 표시에 붙인 메모 */
  note?: string;
  createdAt: number;
}

export function isHlColor(v: unknown): v is HlColor {
  return typeof v === "string" && (HL_COLORS as readonly string[]).includes(v);
}

let counter = 0;
export function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 화면 좌표의 사각형들을 페이지 상자 기준의 비율 좌표로 바꾼다. 페이지 밖으로 나간 부분은 잘라낸다. */
export function toRelativeRects(rects: Box[], page: Box): Rect[] {
  if (page.width <= 0 || page.height <= 0) return [];
  const out: Rect[] = [];
  for (const r of rects) {
    const x1 = Math.max(0, (r.left - page.left) / page.width);
    const y1 = Math.max(0, (r.top - page.top) / page.height);
    const x2 = Math.min(1, (r.left + r.width - page.left) / page.width);
    const y2 = Math.min(1, (r.top + r.height - page.top) / page.height);
    if (x2 - x1 <= 0.001 || y2 - y1 <= 0.001) continue;
    out.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  }
  return out;
}

/**
 * 선택 영역의 사각형들을 정리한다: 다른 사각형 안에 완전히 들어가는 것(중복)은 버리고,
 * 같은 줄에서 겹치거나 맞닿은 것은 하나로 합친다.
 */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = rects
    .filter((r) => r.w > 0 && r.h > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((r) => ({ ...r }));
  const kept = sorted.filter(
    (r, i) =>
      !sorted.some(
        (o, j) =>
          j !== i &&
          o.x <= r.x + 1e-6 &&
          o.y <= r.y + 1e-6 &&
          o.x + o.w >= r.x + r.w - 1e-6 &&
          o.y + o.h >= r.y + r.h - 1e-6 &&
          (o.w > r.w + 1e-9 || o.h > r.h + 1e-9 || j < i),
      ),
  );
  // 같은 줄(세로 중심이 비슷한 것)끼리 묶고, 줄 안에서는 x 순서로 겹치거나 맞닿은 것을 합친다.
  const lines: Rect[][] = [];
  for (const r of kept) {
    const cy = r.y + r.h / 2;
    const line = lines.find((l) => {
      const ref = l[0];
      return Math.abs(ref.y + ref.h / 2 - cy) < Math.min(ref.h, r.h) * 0.5;
    });
    if (line) line.push(r);
    else lines.push([r]);
  }
  const out: Rect[] = [];
  for (const line of lines) {
    line.sort((a, b) => a.x - b.x);
    const merged: Rect[] = [];
    for (const r of line) {
      const last = merged[merged.length - 1];
      if (last && r.x <= last.x + last.w + 0.004) {
        const x2 = Math.max(last.x + last.w, r.x + r.w);
        const y1 = Math.min(last.y, r.y);
        const y2 = Math.max(last.y + last.h, r.y + r.h);
        last.x = Math.min(last.x, r.x);
        last.y = y1;
        last.w = x2 - last.x;
        last.h = y2 - y1;
      } else merged.push({ ...r });
    }
    out.push(...merged);
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** 비율 좌표 (x, y) 가 어느 표시 위에 있는지 (겹치면 가장 나중에 만든 것) */
export function hitHighlight(highlights: Highlight[], page: number, x: number, y: number): Highlight | undefined {
  let hit: Highlight | undefined;
  for (const h of highlights) {
    if (h.page !== page) continue;
    if (h.rects.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) {
      if (!hit || h.createdAt >= hit.createdAt) hit = h;
    }
  }
  return hit;
}

/** 저장소에서 읽은 값이 깨져 있어도 안전하게 걸러낸다. */
export function sanitizeHighlights(raw: unknown): Highlight[] {
  if (!Array.isArray(raw)) return [];
  const out: Highlight[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.page !== "number" || !Array.isArray(o.rects)) continue;
    const rects = o.rects.filter(
      (r): r is Rect =>
        !!r &&
        typeof (r as Rect).x === "number" &&
        typeof (r as Rect).y === "number" &&
        typeof (r as Rect).w === "number" &&
        typeof (r as Rect).h === "number",
    );
    if (rects.length === 0) continue;
    out.push({
      id: o.id,
      page: o.page,
      color: isHlColor(o.color) ? o.color : "yellow",
      rects,
      text: typeof o.text === "string" ? o.text : "",
      note: typeof o.note === "string" && o.note ? o.note : undefined,
      createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
    });
  }
  return out;
}

export function sanitizeNotes(raw: unknown): Record<number, string> {
  const out: Record<number, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(k);
    if (Number.isInteger(n) && n >= 1 && typeof v === "string" && v.trim()) out[n] = v;
  }
  return out;
}

/** 메모와 형광펜을 한 문서로 내보낸다 (Markdown). */
export function exportMarkdown(name: string, notes: Record<number, string>, highlights: Highlight[]): string {
  const pages = new Set<number>([...Object.keys(notes).map(Number), ...highlights.map((h) => h.page)]);
  const lines = [`# ${name}`, ""];
  for (const p of [...pages].sort((a, b) => a - b)) {
    lines.push(`## p.${p}`, "");
    if (notes[p]) lines.push(notes[p].trim(), "");
    for (const h of highlights.filter((x) => x.page === p).sort((a, b) => a.createdAt - b.createdAt)) {
      lines.push(
        `- ==${h.text.replace(/\s+/g, " ").trim()}==${h.note ? ` — ${h.note.replace(/\s+/g, " ").trim()}` : ""}`,
      );
    }
    if (highlights.some((x) => x.page === p)) lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
