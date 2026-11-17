import { describe, expect, it } from "vitest";
import { buildPrompt, escapeAttr } from "./context";

const pages = (map: Record<number, string>) => async (p: number) => map[p] ?? "";

const base = { numPages: 10, fileName: "book.pdf", selection: "", question: "요약해줘" };

describe("buildPrompt", () => {
  it("현재 페이지 ±radius 만 포함한다", async () => {
    const r = await buildPrompt({
      ...base,
      currentPage: 5,
      radius: 1,
      getPageText: pages({ 4: "FOUR", 5: "FIVE", 6: "SIX", 7: "SEVEN", 3: "THREE" }),
    });
    expect([r.from, r.to]).toEqual([4, 6]);
    expect(r.prompt).toContain("FOUR");
    expect(r.prompt).toContain("FIVE");
    expect(r.prompt).toContain("SIX");
    expect(r.prompt).not.toContain("SEVEN");
    expect(r.prompt).not.toContain("THREE");
    expect(r.prompt).toContain('current_page="5"');
    expect(r.prompt.trim().endsWith("요약해줘")).toBe(true);
  });

  it("사용자가 보고 있는 페이지에만 current 표시를 붙인다", async () => {
    const r = await buildPrompt({ ...base, currentPage: 5, radius: 1, getPageText: pages({ 4: "a", 5: "b", 6: "c" }) });
    expect(r.prompt).toContain('<page number="5" current="true">');
    expect(r.prompt).toContain('<page number="4">');
    expect(r.prompt).toContain('<page number="6">');
    expect(r.prompt.match(/current="true"/g)).toHaveLength(1);
  });

  it("문서 처음/끝에서는 범위를 잘라낸다", async () => {
    const first = await buildPrompt({
      ...base,
      currentPage: 1,
      radius: 2,
      getPageText: pages({ 1: "a", 2: "b", 3: "c" }),
    });
    expect([first.from, first.to]).toEqual([1, 3]);
    const last = await buildPrompt({
      ...base,
      currentPage: 10,
      radius: 2,
      getPageText: pages({ 8: "a", 9: "b", 10: "c" }),
    });
    expect([last.from, last.to]).toEqual([8, 10]);
  });

  it("radius 0 이면 현재 페이지만 본다", async () => {
    const r = await buildPrompt({ ...base, currentPage: 3, radius: 0, getPageText: pages({ 2: "X", 3: "Y", 4: "Z" }) });
    expect(r.prompt).toContain("Y");
    expect(r.prompt).not.toContain("X");
    expect(r.prompt).not.toContain("Z");
  });

  it("텍스트가 없는 쪽을 emptyPages 로 알려준다", async () => {
    const r = await buildPrompt({ ...base, currentPage: 5, radius: 1, getPageText: pages({ 4: "text", 6: "text" }) });
    expect(r.emptyPages).toEqual([5]);
    expect(r.prompt).toContain("(no extractable text)");
  });

  it("너무 긴 페이지는 잘라낸다", async () => {
    const r = await buildPrompt({ ...base, currentPage: 1, radius: 0, getPageText: async () => "x".repeat(50000) });
    expect(r.prompt.length).toBeLessThan(13000);
    expect(r.prompt).toContain("(truncated)");
  });

  it("선택한 텍스트가 있으면 selected_text 로 넣고, 공백뿐이면 넣지 않는다", async () => {
    const withSel = await buildPrompt({
      ...base,
      currentPage: 1,
      radius: 0,
      selection: "  핵심 문장  ",
      getPageText: pages({ 1: "p" }),
    });
    expect(withSel.prompt).toContain("<selected_text>\n핵심 문장\n</selected_text>");
    const blank = await buildPrompt({
      ...base,
      currentPage: 1,
      radius: 0,
      selection: "   ",
      getPageText: pages({ 1: "p" }),
    });
    expect(blank.prompt).not.toContain("selected_text");
  });

  it("파일 이름의 특수문자가 구조를 깨지 않는다", async () => {
    const r = await buildPrompt({
      ...base,
      fileName: 'a"><injected/>.pdf',
      currentPage: 1,
      radius: 0,
      getPageText: pages({ 1: "p" }),
    });
    expect(r.prompt).not.toContain("<injected/>");
    expect(r.prompt).toContain("&quot;&gt;&lt;injected/&gt;");
  });
});

describe("escapeAttr", () => {
  it('& < > " 를 이스케이프한다', () => {
    expect(escapeAttr(`a&b<c>"d`)).toBe("a&amp;b&lt;c&gt;&quot;d");
  });

  it("문서 개요와 내 메모는 있을 때만 붙고, 개요는 원문 앞에 온다", async () => {
    const plain = await buildPrompt({ ...base, currentPage: 2, radius: 0, getPageText: pages({ 2: "TWO" }) });
    expect(plain.prompt).not.toContain("document_overview");
    expect(plain.prompt).not.toContain("user_notes");
    expect([plain.overview, plain.notes]).toEqual([false, false]);

    const r = await buildPrompt({
      ...base,
      currentPage: 2,
      radius: 0,
      getPageText: pages({ 2: "TWO" }),
      overview: "<document_overview>OV</document_overview>",
      notes: [
        { page: 2, text: '내 <메모> "중요"' },
        { page: 2, text: "   " },
      ],
    });
    expect(r.prompt.indexOf("document_overview")).toBeLessThan(r.prompt.indexOf("<document_context"));
    expect(r.prompt).toContain('<note page="2">내 &lt;메모&gt; &quot;중요&quot;</note>');
    expect(r.prompt.match(/<note /g)).toHaveLength(1);
    expect(r.prompt.trim().endsWith("요약해줘")).toBe(true);
    expect([r.overview, r.notes]).toEqual([true, true]);
  });

  it("비슷한 쪽은 원문 뒤에 요약·용어·발췌와 함께 붙고, 쪽 번호가 결과에 담긴다", async () => {
    const r = await buildPrompt({
      ...base,
      currentPage: 8,
      radius: 0,
      getPageText: pages({ 8: "EIGHT" }),
      related: [
        { page: 2, terms: ["vpc", "endpoint"], point: "엔드포인트 정책 개요", excerpt: "…Endpoint Policy 는…" },
        { page: 5, terms: [], excerpt: "FIVE 발췌" },
      ],
    });
    expect(r.related).toEqual([2, 5]);
    expect(r.prompt).toContain("<related_pages");
    expect(r.prompt).toContain(
      '<related page="2" terms="vpc, endpoint">\n[요약] 엔드포인트 정책 개요\n…Endpoint Policy 는…\n</related>',
    );
    expect(r.prompt).toContain('<related page="5">\nFIVE 발췌\n</related>');
    expect(r.prompt.indexOf("</document_context>")).toBeLessThan(r.prompt.indexOf("<related_pages"));
    expect(r.prompt.trim().endsWith("요약해줘")).toBe(true);
    expect((await buildPrompt({ ...base, currentPage: 8, radius: 0, getPageText: pages({ 8: "x" }) })).related).toEqual(
      [],
    );
  });

  it("첨부 파일은 원문 앞에 <attached_files> 로, 이름·잘림 표시와 함께 붙는다", async () => {
    const r = await buildPrompt({
      ...base,
      currentPage: 3,
      radius: 0,
      getPageText: pages({ 3: "THREE" }),
      attachments: [
        { name: 'a"b.md', text: "# 노트\n내용" },
        { name: "long.txt", text: "앞부분", cut: true },
        { name: "empty.txt", text: "  " },
      ],
    });
    expect(r.attached).toEqual(['a"b.md', "long.txt"]);
    expect(r.prompt).toContain('<file name="a&quot;b.md">\n# 노트\n내용\n</file>');
    expect(r.prompt).toContain('<file name="long.txt" truncated="true">');
    expect(r.prompt.indexOf("<attached_files")).toBeLessThan(r.prompt.indexOf("<document_context"));
    expect(r.prompt.trim().endsWith("요약해줘")).toBe(true);
    expect(
      (await buildPrompt({ ...base, currentPage: 3, radius: 0, getPageText: pages({ 3: "x" }) })).attached,
    ).toEqual([]);
  });
});
