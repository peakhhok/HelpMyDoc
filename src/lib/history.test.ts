import { describe, expect, it } from "vitest";
import { linkifyPages, trimHistory } from "./history";

const msgs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: String(i),
  }));

describe("trimHistory", () => {
  it("한도 이하면 내용을 그대로 돌려준다", () => {
    const h = msgs(6);
    expect(trimHistory(h)).toEqual(h);
  });

  it("메시지 수 한도: 최근 것만 남기고 항상 user 로 시작한다", () => {
    const h = msgs(10); // user, assistant, user, ... , assistant
    expect(trimHistory(h, { maxMessages: 4 }).map((m) => m.content)).toEqual(["6", "7", "8", "9"]); // 6 은 user
    // 자른 결과가 assistant 로 시작하면 그 메시지는 버린다
    expect(trimHistory(h, { maxMessages: 5 }).map((m) => m.content)).toEqual(["6", "7", "8", "9"]);
    expect(trimHistory(h, { maxMessages: 5 })[0].role).toBe("user");
  });

  it("글자 수 한도: 긴 답변이 쌓이면 개수와 상관없이 오래된 것부터 버린다", () => {
    const h = [
      { role: "user" as const, content: "q1" },
      { role: "assistant" as const, content: "a".repeat(50) },
      { role: "user" as const, content: "q2" },
      { role: "assistant" as const, content: "b".repeat(50) },
      { role: "user" as const, content: "q3" },
      { role: "assistant" as const, content: "c".repeat(50) },
    ];
    // 뒤에서부터 c(50) + q3(2) + b(50) = 102 까지 담기고 q2 에서 한도를 넘는다.
    // 결과가 assistant(b)로 시작하므로 b 는 버려서 user 로 시작하게 한다.
    const out = trimHistory(h, { maxChars: 102 });
    expect(out.map((m) => m.content[0])).toEqual(["q", "c"]); // q3, ccc…
    expect(out[0].role).toBe("user");
  });

  it("가장 최근 메시지는 한도를 넘어도 남긴다", () => {
    const h = [
      { role: "user" as const, content: "x".repeat(500) },
      { role: "assistant" as const, content: "y".repeat(500) },
      { role: "user" as const, content: "z".repeat(500) },
    ];
    const out = trimHistory(h, { maxChars: 100 });
    expect(out).toHaveLength(1);
    expect(out[0].content[0]).toBe("z");
  });

  it("기본 한도는 넉넉하다 (대화 수십 번은 그대로 유지)", () => {
    const h = msgs(80).map((m) => ({ ...m, content: "내용".repeat(100) })); // 메시지당 200자
    expect(trimHistory(h)).toHaveLength(80);
  });

  it("빈 대화", () => {
    expect(trimHistory([])).toEqual([]);
  });
});

describe("linkifyPages", () => {
  it("p.N 과 범위를 페이지 링크로 바꾼다", () => {
    expect(linkifyPages("핵심은 (p.120)에 있고 pp.5–8 도 보세요", 500)).toBe(
      "핵심은 ([p.120](#page-120))에 있고 [pp.5–8](#page-5) 도 보세요",
    );
    expect(linkifyPages("p. 7 그리고 p.3-4", 10)).toBe("[p. 7](#page-7) 그리고 [p.3-4](#page-3)");
  });

  it("문서 범위를 벗어난 번호와 0 은 링크로 만들지 않는다", () => {
    expect(linkifyPages("p.999 p.0", 40)).toBe("p.999 p.0");
  });

  it("코드 블록과 인라인 코드 안은 건드리지 않는다", () => {
    const md = "설명 p.3\n```\nprint(p.3)\n```\n`p.4` 와 p.5";
    expect(linkifyPages(md, 10)).toBe("설명 [p.3](#page-3)\n```\nprint(p.3)\n```\n`p.4` 와 [p.5](#page-5)");
  });

  it("단어 중간의 p. 는 무시하고, 문서가 없으면 그대로 둔다", () => {
    expect(linkifyPages("step.3 ep.5", 10)).toBe("step.3 ep.5");
    expect(linkifyPages("p.3", 0)).toBe("p.3");
  });
});
