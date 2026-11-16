import { describe, expect, it } from "vitest";
import {
  exportMarkdown,
  hitHighlight,
  mergeRects,
  sanitizeHighlights,
  sanitizeNotes,
  toRelativeRects,
  type Highlight,
} from "./annotations";

const page = { left: 100, top: 50, width: 400, height: 500 };

describe("toRelativeRects", () => {
  it("화면 좌표를 페이지 크기 대비 비율로 바꾼다 (확대·축소해도 같은 값)", () => {
    const [r] = toRelativeRects([{ left: 140, top: 100, width: 80, height: 25 }], page);
    expect(r.x).toBeCloseTo(0.1);
    expect(r.y).toBeCloseTo(0.1);
    expect(r.w).toBeCloseTo(0.2);
    expect(r.h).toBeCloseTo(0.05);
    // 두 배로 확대된 화면(페이지 800x1000)에서 같은 곳을 칠하면 같은 비율이 나온다
    const [z] = toRelativeRects([{ left: 180, top: 100, width: 160, height: 50 }], {
      left: 100,
      top: 0,
      width: 800,
      height: 1000,
    });
    expect(z.x).toBeCloseTo(0.1);
    expect(z.w).toBeCloseTo(0.2);
    expect(z.h).toBeCloseTo(0.05);
  });

  it("페이지 밖으로 나간 부분은 잘라내고, 거의 보이지 않는 것은 버린다", () => {
    const rs = toRelativeRects(
      [
        { left: 90, top: 40, width: 30, height: 30 }, // 왼쪽 위로 삐져나감
        { left: 700, top: 700, width: 10, height: 10 }, // 완전히 밖
      ],
      page,
    );
    expect(rs).toHaveLength(1);
    expect(rs[0].x).toBe(0);
    expect(rs[0].y).toBe(0);
    expect(
      toRelativeRects([{ left: 0, top: 0, width: 10, height: 10 }], { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual([]);
  });
});

describe("mergeRects", () => {
  it("다른 사각형 안에 들어가는 중복은 버린다", () => {
    const out = mergeRects([
      { x: 0.1, y: 0.1, w: 0.5, h: 0.03 },
      { x: 0.2, y: 0.1, w: 0.1, h: 0.03 },
      { x: 0.1, y: 0.1, w: 0.5, h: 0.03 },
    ]);
    expect(out).toHaveLength(1);
  });

  it("같은 줄에서 맞닿은 조각은 하나로 합치고, 다른 줄은 따로 둔다", () => {
    const out = mergeRects([
      { x: 0.5, y: 0.101, w: 0.2, h: 0.03 },
      { x: 0.1, y: 0.1, w: 0.2, h: 0.03 },
      { x: 0.3, y: 0.1, w: 0.2, h: 0.03 },
      { x: 0.1, y: 0.2, w: 0.3, h: 0.03 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].x).toBeCloseTo(0.1);
    expect(out[0].w).toBeCloseTo(0.6);
    expect(out[1].y).toBeCloseTo(0.2);
  });

  it("떨어져 있는 같은 줄의 조각은 합치지 않는다", () => {
    const out = mergeRects([
      { x: 0.1, y: 0.1, w: 0.1, h: 0.03 },
      { x: 0.6, y: 0.1, w: 0.1, h: 0.03 },
    ]);
    expect(out).toHaveLength(2);
  });
});

const hl = (id: string, p: number, createdAt: number): Highlight => ({
  id,
  page: p,
  color: "yellow",
  rects: [{ x: 0.1, y: 0.1, w: 0.5, h: 0.05 }],
  text: id,
  createdAt,
});

describe("hitHighlight", () => {
  it("같은 쪽의 표시만, 겹치면 나중에 만든 것을 고른다", () => {
    const list = [hl("a", 1, 1), hl("b", 1, 2), hl("c", 2, 3)];
    expect(hitHighlight(list, 1, 0.2, 0.12)?.id).toBe("b");
    expect(hitHighlight(list, 2, 0.2, 0.12)?.id).toBe("c");
    expect(hitHighlight(list, 1, 0.9, 0.9)).toBeUndefined();
  });
});

describe("저장값 검증", () => {
  it("깨진 형광펜·메모는 걸러내고 알 수 없는 색은 노랑으로", () => {
    const out = sanitizeHighlights([
      { id: "ok", page: 3, color: "purple", rects: [{ x: 0, y: 0, w: 1, h: 1 }], text: "t", note: "", createdAt: 5 },
      { id: "no-rects", page: 1, rects: [] },
      { id: 1, page: 1, rects: [] },
      null,
      "x",
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "ok", color: "yellow", note: undefined });
    expect(sanitizeHighlights("bad")).toEqual([]);
    expect(sanitizeNotes({ 3: "메모", x: "bad", 0: "bad", 5: "  ", 7: 9 })).toEqual({ 3: "메모" });
    expect(sanitizeNotes(null)).toEqual({});
  });
});

describe("exportMarkdown", () => {
  it("쪽 순서로 메모와 표시를 내보낸다", () => {
    const md = exportMarkdown("책.pdf", { 5: "중요", 2: "메모" }, [
      { ...hl("a", 5, 1), text: "핵심  문장", note: "시험에 나옴" },
      hl("b", 9, 2),
    ]);
    expect(md.indexOf("p.2")).toBeLessThan(md.indexOf("p.5"));
    expect(md.indexOf("p.5")).toBeLessThan(md.indexOf("p.9"));
    expect(md).toContain("- ==핵심 문장== — 시험에 나옴");
    expect(md).toContain("# 책.pdf");
  });
});
