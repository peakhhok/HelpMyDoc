// 파일 종류를 이름(확장자)만이 아니라 내용으로도 알아본다.
// 확장자가 없는 링크/복사본, 이름이 바뀐 파일을 끌어다 놓아도 열리게 하기 위해서다.
import { unzipSync } from "fflate";

export type FileKind = "pdf" | "pptx" | "docx";

export type Unsupported = "lnk" | "ppt" | "doc" | "other";

const EXT: Record<string, FileKind> = { pdf: "pdf", pptx: "pptx", docx: "docx" };

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i < 0 ? "" : name.slice(i + 1).toLowerCase();
}

/** 내용으로 종류를 알아본다: %PDF- 로 시작하면 PDF, 압축 파일이면 안의 구성으로 PowerPoint/Word 를 구분한다. */
export function sniffKind(bytes: Uint8Array): FileKind | null {
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return "pdf";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) {
    try {
      const found = unzipSync(bytes, {
        filter: (f) => f.name === "ppt/presentation.xml" || f.name === "word/document.xml",
      });
      if (found["ppt/presentation.xml"]) return "pptx";
      if (found["word/document.xml"]) return "docx";
    } catch {
      /* 압축 파일이 아님 */
    }
  }
  return null;
}

/**
 * 이름과 내용으로 종류를 정한다. 지원하는 종류면 FileKind, 아니면 왜 못 여는지 알려 줄 분류를 돌려준다.
 */
export function detectKind(name: string, bytes: Uint8Array): { kind: FileKind } | { unsupported: Unsupported } {
  const ext = extOf(name);
  // 확장자가 맞아도 내용이 다르면 내용을 믿는다 (이름만 바뀐 파일)
  const sniffed = sniffKind(bytes);
  if (sniffed) return { kind: sniffed };
  if (EXT[ext]) return { kind: EXT[ext] }; // 내용을 못 알아봐도 확장자가 지원 형식이면 시도해서 구체적인 오류를 보여 준다
  if (ext === "lnk") return { unsupported: "lnk" };
  if (ext === "ppt") return { unsupported: "ppt" };
  if (ext === "doc") return { unsupported: "doc" };
  return { unsupported: "other" };
}

export function unsupportedMessage(u: Unsupported, name: string): string {
  switch (u) {
    case "lnk":
      return `"${name}"은 바로가기(.lnk) 파일이라 열 수 없어요. 원본 파일을 끌어다 놓거나 "파일 열기"로 골라 주세요.`;
    case "ppt":
      return "옛 PowerPoint(.ppt)는 열 수 없어요. PowerPoint에서 .pptx 또는 PDF로 저장해서 열어 주세요.";
    case "doc":
      return "Word 문서는 문서로 열 수 없어요. PDF로 저장해서 열거나, 채팅창에 첨부(📎)해서 AI에게 읽혀 보세요.";
    default:
      return `"${name}"은(는) 열 수 없는 파일이에요. PDF 또는 PowerPoint(.pptx) 파일을 열어 주세요.`;
  }
}
