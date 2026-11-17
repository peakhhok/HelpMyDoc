import { describe, expect, it, vi } from "vitest";
import {
  CHUNK_MAX_CHARS,
  CHUNK_MAX_PAGES,
  buildOverview,
  buildScanPrompt,
  digestMap,
  estimateScan,
  parseScanReply,
  planChunks,
  remainingChunks,
  runScan,
  sanitizeScan,
  upsertChunk,
  type ScanData,
} from "./scan";

describe("planChunks", () => {
  it("글자 수 상한을 넘기기 전에 구간을 끊고, 모든 쪽이 정확히 한 구간에 속한다", () => {
    const pages = Array.from({ length: 80 }, () => 5000);
    const plan = planChunks(pages);
    const perChunk = Math.floor(CHUNK_MAX_CHARS / 5000);
    expect(plan.every((c) => c.chars <= CHUNK_MAX_CHARS)).toBe(true);
    expect(plan[0]).toMatchObject({ from: 1, to: perChunk });
    expect(plan[plan.length - 1].to).toBe(80);
    const covered = plan.flatMap((c) => Array.from({ length: c.to - c.from + 1 }, (_, i) => c.from + i));
    expect(covered).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
  });

  it("짧은 문서는 한 번에 읽는다", () => {
    expect(planChunks(Array.from({ length: 40 }, () => 1500))).toHaveLength(1);
  });

  it("글자가 적어도 쪽 수 상한으로 끊는다", () => {
    const plan = planChunks(Array.from({ length: CHUNK_MAX_PAGES * 2 + 5 }, () => 10));
    expect(plan.map((c) => c.to - c.from + 1)).toEqual([CHUNK_MAX_PAGES, CHUNK_MAX_PAGES, 5]);
  });

  it("너무 긴 한 쪽은 상한까지만 센다", () => {
    expect(planChunks([100000])[0].chars).toBeLessThan(100000);
  });

  it("텍스트가 전혀 없는 구간(스캔본)은 계획에서 빼고, 같은 입력이면 같은 계획", () => {
    expect(planChunks([0, 0, 0])).toEqual([]);
    const a = planChunks([100, 0, 200, 300, 0]);
    expect(a).toEqual(planChunks([100, 0, 200, 300, 0]));
    expect(a).toHaveLength(1);
    expect(a[0].textPages).toBe(3);
  });

  it("예상치: 구간 수, 글자 수, 읽을 수 없는 쪽", () => {
    const e = estimateScan([100, 0, 200]);
    expect(e).toMatchObject({ chunks: 1, chars: 300, emptyPages: [2] });
    expect(e.approxTokens).toBeGreaterThan(0);
  });
});

describe("parseScanReply", () => {
  const c = { from: 3, to: 9 };
  it("TITLE/SUMMARY 형식을 읽는다", () => {
    const r = parseScanReply("TITLE: VPC 기초\nSUMMARY:\n- 서브넷 (p.3)\n- 라우팅 (p.5)", c);
    expect(r).toMatchObject({ from: 3, to: 9, title: "VPC 기초" });
    expect(r.summary).toContain("- 서브넷 (p.3)");
  });
  it("굵은 글씨·전각 콜론이 섞여도 읽는다", () => {
    const r = parseScanReply("**TITLE**： 보안\n**SUMMARY**：\n- 암호화", c);
    expect(r.title).toBe("보안");
    expect(r.summary).toBe("- 암호화");
  });
  it("형식을 안 지키면 답 전체를 요약으로 쓰고 제목은 쪽 범위로", () => {
    const r = parseScanReply("그냥 서술형 답변입니다", c);
    expect(r).toMatchObject({ title: "p.3–9", summary: "그냥 서술형 답변입니다" });
  });
  it("너무 긴 요약은 자른다", () => {
    expect(parseScanReply("TITLE: t\nSUMMARY: " + "가".repeat(9000), c).summary.length).toBeLessThan(4100);
  });

  it("PAGES 형식이면 쪽별 한 줄 요약과 용어를 읽고, 구간 밖·중복 쪽은 버린다", () => {
    const r = parseScanReply(
      [
        "TITLE: VPC 정책",
        "PAGES:",
        "p.3 | VPC Endpoint 개요 | 용어: VPC Endpoint, 엔드포인트, S3",
        "- p.4 | 정책 문서 예시 | 용어: Endpoint Policy, Resource Policy",
        "**p.5**: 잘못된 형식은 무시",
        "p.5 | 라우팅 | 용어: route table",
        "p.4 | 중복 줄 | 용어: x",
        "p.99 | 구간 밖 | 용어: y",
      ].join("\n"),
      c,
    );
    expect(r.title).toBe("VPC 정책");
    expect(r.pages?.map((d) => d.page)).toEqual([3, 4, 5]);
    expect(r.pages?.[0]).toEqual({ page: 3, point: "VPC Endpoint 개요", terms: ["VPC Endpoint", "엔드포인트", "S3"] });
    expect(r.pages?.[1].terms).toEqual(["Endpoint Policy", "Resource Policy"]);
    expect(r.summary).toContain("p.3  VPC Endpoint 개요 [VPC Endpoint, 엔드포인트, S3]");
    expect(digestMap({ version: 1, provider: "x", updatedAt: 1, chunks: [r] }).get(4)?.point).toBe("정책 문서 예시");
  });

  it("옛 형식(SUMMARY)의 결과에는 pages 가 없다", () => {
    expect(parseScanReply("TITLE: t\nSUMMARY: x", c).pages).toBeUndefined();
  });
});

describe("buildScanPrompt", () => {
  it("쪽 텍스트를 <document_context> 로 감싸고 형식 지시를 붙인다", () => {
    const p = buildScanPrompt({
      fileName: 'a"b.pdf',
      numPages: 50,
      chunk: { from: 1, to: 2 },
      pageTexts: [
        { page: 1, text: "ONE" },
        { page: 2, text: "" },
      ],
    });
    expect(p).toContain('file="a&quot;b.pdf"');
    expect(p).toContain('<page number="1">\nONE\n</page>');
    expect(p).toContain("(no extractable text)");
    expect(p).toContain("TITLE:");
  });
});

const scan = (chunks: Array<[number, number, string]>): ScanData => ({
  version: 1,
  provider: "claude-code",
  updatedAt: 1,
  chunks: chunks.map(([from, to, title]) => ({ from, to, title, summary: `S:${title}` })),
});

describe("runScan", () => {
  const plan = [
    { from: 1, to: 5, chars: 10, textPages: 5 },
    { from: 6, to: 10, chars: 10, textPages: 5 },
    { from: 11, to: 12, chars: 10, textPages: 2 },
  ];
  const base = { buildPrompt: async (c: { from: number }) => `P${c.from}` };

  it("남은 구간만 차례로 읽히고 구간마다 결과를 알린다 (이어하기)", async () => {
    const ask = vi.fn(async (p: string) => `TITLE: T${p}\nSUMMARY: s${p}`);
    const got: string[] = [];
    const prog: number[] = [];
    await runScan({
      ...base,
      plan,
      existing: scan([[1, 5, "이미함"]]),
      ask,
      signal: new AbortController().signal,
      onProgress: (p) => prog.push(p.done),
      onChunk: (c) => got.push(c.title),
    });
    expect(ask).toHaveBeenCalledTimes(2);
    expect(got).toEqual(["TP6", "TP11"]);
    expect(prog[0]).toBe(1);
    expect(prog[prog.length - 1]).toBe(3);
  });

  it("중간에 오류가 나면 거기서 멈추지만 지금까지의 결과는 이미 전달됐다", async () => {
    let n = 0;
    const got: string[] = [];
    await expect(
      runScan({
        ...base,
        plan,
        existing: null,
        ask: async (p) => {
          if (++n === 2) throw new Error("한도 초과");
          return `TITLE: ${p}\nSUMMARY: x`;
        },
        signal: new AbortController().signal,
        onProgress: () => {},
        onChunk: (c) => got.push(c.title),
      }),
    ).rejects.toThrow("한도 초과");
    expect(got).toEqual(["P1"]);
  });

  it("중지하면 AbortError, 빈 답은 오류", async () => {
    const ac = new AbortController();
    await expect(
      runScan({
        ...base,
        plan,
        existing: null,
        ask: async () => {
          ac.abort();
          return "TITLE: a\nSUMMARY: b";
        },
        signal: ac.signal,
        onProgress: () => {},
        onChunk: () => {},
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      runScan({
        ...base,
        plan,
        existing: null,
        ask: async () => "  ",
        signal: new AbortController().signal,
        onProgress: () => {},
        onChunk: () => {},
      }),
    ).rejects.toThrow("빈 답");
  });

  it("remainingChunks / upsertChunk", () => {
    expect(remainingChunks(plan, scan([[6, 10, "x"]])).map((c) => c.from)).toEqual([1, 11]);
    const s = upsertChunk(scan([[6, 10, "old"]]), "codex", { from: 6, to: 10, title: "new", summary: "n" });
    expect(s.chunks).toHaveLength(1);
    expect(s.chunks[0].title).toBe("new");
    expect(s.provider).toBe("codex");
    const s2 = upsertChunk(s, "codex", { from: 1, to: 5, title: "first", summary: "f" });
    expect(s2.chunks.map((c) => c.from)).toEqual([1, 6]);
  });
});

describe("buildOverview", () => {
  it("스캔 결과가 없으면 빈 문자열", () => {
    expect(buildOverview(null, 3)).toBe("");
    expect(buildOverview({ version: 1, provider: "", chunks: [], updatedAt: 0 }, 3)).toBe("");
  });

  it("전체 목차와, 지금 보는 구간의 요약만 담는다", () => {
    const o = buildOverview(
      scan([
        [1, 5, "개요"],
        [6, 10, "네트워크"],
        [11, 12, "보안"],
      ]),
      7,
    );
    expect(o).toContain("p.1–5  개요");
    expect(o).toContain("p.6–10  네트워크");
    expect(o).toContain("p.11–12  보안");
    expect(o).toContain("S:네트워크"); // 현재 구간 요약
    const withPages = scan([
      [1, 5, "개요"],
      [6, 10, "네트워크"],
    ]);
    withPages.chunks[1].pages = [{ page: 7, point: "p", terms: [] }];
    expect(buildOverview(withPages, 7)).not.toContain("S:네트워크"); // 쪽별 요약이 있으면 구간 요약은 생략
    expect(o).not.toContain("S:개요");
    expect(o).not.toContain("S:보안");
    expect(o).toContain("<document_overview");
  });

  it("목차가 너무 길면 잘라낸다", () => {
    const many = Array.from(
      { length: 500 },
      (_, i) => [i * 2 + 1, i * 2 + 2, "아주 긴 제목 ".repeat(5)] as [number, number, string],
    );
    const o = buildOverview(scan(many), 1);
    expect(o.length).toBeLessThan(9000);
    expect(o).toContain("이하 생략");
  });
});

describe("sanitizeScan", () => {
  it("깨진 값은 null, 정상 값은 쪽 순서로 정렬", () => {
    expect(sanitizeScan(null)).toBeNull();
    expect(sanitizeScan({ chunks: "x" })).toBeNull();
    expect(sanitizeScan({ chunks: [{ from: "a" }] })).toBeNull();
    const s = sanitizeScan({
      provider: "p",
      chunks: [
        { from: 6, to: 7, summary: "b" },
        { from: 1, to: 5, title: "t", summary: "a" },
      ],
    });
    expect(s?.chunks.map((c) => c.from)).toEqual([1, 6]);
  });
});
