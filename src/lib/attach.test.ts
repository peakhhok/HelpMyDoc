import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { beforeAll, describe, expect, it } from "vitest";
import {
  MAX_CHARS_PER_FILE,
  MAX_CHARS_TOTAL,
  decodeText,
  fitAttachments,
  looksBinary,
  readAttachment,
  sanitizeAttachments,
} from "./attach";
import { setXmlParser } from "./pptx/xml";

beforeAll(() => setXmlParser((xml) => new DOMParser().parseFromString(xml, "text/xml") as unknown as Document));

const file = (name: string, content: BlobPart, type = "") => new File([content], name, { type });
const fixture = (rel: string) => readFileSync(new URL(rel, import.meta.url));

describe("decodeText", () => {
  it("UTF-8 (BOM 포함)과 옛 한글(CP949)을 모두 읽는다", () => {
    expect(decodeText(new TextEncoder().encode("안녕 hello"))).toBe("안녕 hello");
    expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x69]))).toBe("hi");
    // "안녕" 의 CP949(EUC-KR) 바이트
    expect(decodeText(new Uint8Array([0xbe, 0xc8, 0xb3, 0xe7]))).toBe("안녕");
  });
  it("바이너리 판별", () => {
    expect(looksBinary(new Uint8Array([1, 2, 0, 0, 0, 5, 0, 7]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode("plain text"))).toBe(false);
  });
});

describe("readAttachment", () => {
  it("md/txt/코드 같은 글 파일은 그대로 읽는다", async () => {
    const a = await readAttachment(file("notes.md", "# 제목\n\n- 항목 1\r\n- 항목 2"));
    expect(a.name).toBe("notes.md");
    expect(a.text).toBe("# 제목\n\n- 항목 1\n- 항목 2");
    expect(a.truncated).toBe(false);
    expect((await readAttachment(file("main.py", "print('hi')"))).text).toContain("print");
    expect((await readAttachment(file("Dockerfile", "FROM node"))).text).toBe("FROM node");
  });

  it("확장자가 없거나 낯설어도 글이면 읽고, 바이너리면 거절한다", async () => {
    expect((await readAttachment(file("README", "그냥 글"))).text).toBe("그냥 글");
    await expect(
      readAttachment(file("photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 0, 0]))),
    ).rejects.toThrow(/읽을 수 없는/);
    await expect(readAttachment(file("a.zip", new Uint8Array([0x50, 0x4b, 3, 4, 0, 0, 0, 0, 0, 0])))).rejects.toThrow(
      /읽을 수 없는/,
    );
  });

  it("옛 형식(.doc/.ppt/.hwp/.xlsx)은 안내와 함께 거절", async () => {
    for (const n of ["a.doc", "a.ppt", "a.hwp", "a.xlsx"]) {
      await expect(readAttachment(file(n, "x"))).rejects.toThrow(/PDF나 글 파일/);
    }
  });

  it("빈 파일은 거절", async () => {
    await expect(readAttachment(file("empty.txt", "   \n"))).rejects.toThrow(/읽을 수 있는 글이 없어요/);
  });

  it("긴 글은 앞부분만 담고 truncated 표시", async () => {
    const a = await readAttachment(file("big.txt", "가".repeat(MAX_CHARS_PER_FILE + 500)));
    expect(a.text.length).toBe(MAX_CHARS_PER_FILE);
    expect(a.chars).toBe(MAX_CHARS_PER_FILE + 500);
    expect(a.truncated).toBe(true);
  });

  it("Word(.docx): 제목은 #, 표는 ' | ' 로 뽑는다", async () => {
    const a = await readAttachment(file("sample.docx", fixture("./fixtures/sample.docx")));
    expect(a.text).toContain("# VPC Endpoint 정리");
    expect(a.text).toContain("## 정책 비교");
    expect(a.text).toContain("엔드포인트 정책은 IAM 정책과 별개로 평가된다.");
    expect(a.text).toContain("IAM Policy | Principal");
    expect(a.text.indexOf("정책 | 대상")).toBeLessThan(a.text.indexOf("마지막 문단"));
  });

  it("PowerPoint(.pptx): 슬라이드별로 구분해 뽑는다 (발표자 노트 포함)", async () => {
    const a = await readAttachment(file("lecture.pptx", fixture("./pptx/fixtures/lecture.pptx")));
    expect(a.text).toContain("--- 슬라이드 1 ---");
    expect(a.text).toContain("--- 슬라이드 5 ---");
    expect(a.text).toContain("IAM Policy + VPC Endpoint Policy + Resource Policy");
    expect(a.text).toContain("엔드포인트 정책은 IAM 정책과 별개로 평가된다");
  });

  it("손상된 Word 파일은 안내 문구", async () => {
    await expect(readAttachment(file("bad.docx", "not a zip"))).rejects.toThrow(/docx/);
  });
});

describe("fitAttachments", () => {
  const mk = (name: string, n: number) => ({ id: name, name, text: "a".repeat(n), chars: n, truncated: false });
  it("전체 한도를 넘으면 뒤쪽 파일을 줄이고 표시한다", () => {
    const out = fitAttachments([mk("a", MAX_CHARS_TOTAL - 100), mk("b", 500), mk("c", 10)]);
    expect(out[0].text.length).toBe(MAX_CHARS_TOTAL - 100);
    expect(out[0].cut).toBe(false);
    expect(out[1].text.length).toBe(100);
    expect(out[1].cut).toBe(true);
    expect(out[2].text.length).toBe(0);
    expect(out[2].cut).toBe(true);
  });
  it("한도 안이면 그대로", () => {
    expect(fitAttachments([mk("a", 10)])).toEqual([{ name: "a", text: "a".repeat(10), cut: false }]);
  });
});

describe("sanitizeAttachments", () => {
  it("깨진 저장값은 걸러낸다", () => {
    expect(sanitizeAttachments("x")).toEqual([]);
    const out = sanitizeAttachments([{ id: "1", name: "a", text: "t" }, { id: 2 }, null]);
    expect(out).toEqual([{ id: "1", name: "a", text: "t", chars: 1, truncated: false }]);
  });
});
