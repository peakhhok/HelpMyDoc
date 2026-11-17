import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectKind, sniffKind, unsupportedMessage } from "./fileKind";

const pptx = new Uint8Array(readFileSync(new URL("./pptx/fixtures/lecture.pptx", import.meta.url)));
const docx = new Uint8Array(readFileSync(new URL("./fixtures/sample.docx", import.meta.url)));
const pdf = new TextEncoder().encode("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
const text = new TextEncoder().encode("hello world");

describe("sniffKind", () => {
  it("내용으로 PDF / PowerPoint / Word 를 구분한다", () => {
    expect(sniffKind(pdf)).toBe("pdf");
    expect(sniffKind(pptx)).toBe("pptx");
    expect(sniffKind(docx)).toBe("docx");
    expect(sniffKind(text)).toBeNull();
    expect(sniffKind(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]))).toBeNull(); // 깨진 압축 파일
  });
  it("글 속에 '%PDF-' 라는 말이 들어 있다고 PDF 로 보지 않는다 (맨 앞에서만)", () => {
    expect(sniffKind(new TextEncoder().encode("이 파일은 %PDF- 로 시작해요"))).toBeNull();
  });
});

describe("detectKind", () => {
  it("확장자가 없거나 틀려도 내용으로 연다 (링크·이름이 바뀐 파일)", () => {
    expect(detectKind("report", pdf)).toEqual({ kind: "pdf" });
    expect(detectKind("slides (1)", pptx)).toEqual({ kind: "pptx" });
    expect(detectKind("lecture.pdf", pptx)).toEqual({ kind: "pptx" }); // 이름은 pdf 지만 내용은 pptx
    expect(detectKind("a.txt", pdf)).toEqual({ kind: "pdf" });
  });
  it("내용을 못 알아봐도 확장자가 지원 형식이면 시도한다 (구체적인 오류를 보여 주기 위해)", () => {
    expect(detectKind("broken.pdf", text)).toEqual({ kind: "pdf" });
    expect(detectKind("broken.PPTX", text)).toEqual({ kind: "pptx" });
  });
  it("지원하지 않는 것은 이유를 분류한다", () => {
    expect(detectKind("문서.pdf.lnk", new Uint8Array([0x4c, 0, 0, 0]))).toEqual({ unsupported: "lnk" });
    expect(detectKind("old.ppt", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({ unsupported: "ppt" });
    expect(detectKind("old.doc", new Uint8Array([0xd0, 0xcf, 0x11, 0xe0]))).toEqual({ unsupported: "doc" });
    expect(detectKind("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ unsupported: "other" });
  });
  it("안내 문구", () => {
    expect(unsupportedMessage("lnk", "a.lnk")).toContain("바로가기");
    expect(unsupportedMessage("ppt", "a.ppt")).toContain(".pptx");
    expect(unsupportedMessage("other", "x.png")).toContain("x.png");
  });
});
