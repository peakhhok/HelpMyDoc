// 채팅창에 올린 파일을 글로 바꾼다. 문서 위주: 글 파일(md, txt, 코드 …), PDF, PowerPoint(.pptx), Word(.docx).
// 이미지·압축 파일 같은 것은 읽을 수 없다고 알려 준다. 여기서 만든 글이 질문에 함께 전송된다.
import { strFromU8, unzipSync } from "fflate";
import { parsePptx } from "./pptx/parse";
import { sniffKind } from "./fileKind";
import { descendants, kids, name, parseXml, type El } from "./pptx/xml";

export interface Attachment {
  id: string;
  name: string;
  /** AI 에게 보낼 글 (너무 길면 앞부분만) */
  text: string;
  /** 원래 글자 수 */
  chars: number;
  /** 길어서 앞부분만 담음 */
  truncated: boolean;
}

/** 파일 하나에서 보내는 최대 글자 수와, 한 번의 질문에 함께 보내는 첨부 전체의 최대 글자 수 */
export const MAX_CHARS_PER_FILE = 60_000;
export const MAX_CHARS_TOTAL = 120_000;
/** 올릴 수 있는 파일 크기 */
export const MAX_FILE_BYTES = 30 * 1024 * 1024;

const TEXT_EXT = new Set([
  "md",
  "markdown",
  "txt",
  "text",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "yaml",
  "yml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "xml",
  "html",
  "htm",
  "css",
  "log",
  "rst",
  "tex",
  "sql",
  "sh",
  "bat",
  "ps1",
  "py",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "tf",
  "env",
  "gitignore",
  "dockerfile",
]);

const extOf = (n: string) => {
  const i = n.lastIndexOf(".");
  return i < 0 ? n.toLowerCase() : n.slice(i + 1).toLowerCase();
};

let counter = 0;
const newId = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 글 파일의 바이트를 글로 읽는다. UTF-8 이 아니면(윈도우 메모장의 옛 한글 저장 등) CP949 로 읽는다. */
export function decodeText(bytes: Uint8Array): string {
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const body = bytes.subarray(start);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder("euc-kr").decode(body);
    } catch {
      return new TextDecoder("utf-8").decode(body);
    }
  }
}

/** 글 파일이 아니라 바이너리처럼 보이는가 (NUL 바이트가 많음) */
export function looksBinary(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 4096);
  let nul = 0;
  for (let i = 0; i < n; i++) if (bytes[i] === 0) nul++;
  return nul > 0 && nul / Math.max(1, n) > 0.001;
}

const W = (el: El | null | undefined, tag: string) => kids(el, tag);

/** .docx 의 본문 글: 문단은 줄로, 제목 스타일은 #, 표는 행마다 " | " 로 */
export function docxToText(buffer: ArrayBuffer): string {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(buffer));
  } catch {
    throw new Error("Word(.docx) 파일이 아니거나 손상된 파일입니다. (옛 .doc 는 .docx 로 저장해서 올려 주세요)");
  }
  const data = files["word/document.xml"];
  if (!data) throw new Error("Word(.docx) 파일이 아니거나 손상된 파일입니다.");
  const root = parseXml(strFromU8(data));
  const body = kids(root, "body")[0] ?? root;

  const paraText = (p: El): string => {
    let out = "";
    for (const n of descendants(p)) {
      const tag = name(n);
      if (tag === "t") out += n.textContent ?? "";
      else if (tag === "tab") out += "\t";
      else if (tag === "br" || tag === "cr") out += "\n";
    }
    return out;
  };
  const heading = (p: El): number => {
    const style = kids(kids(p, "pPr")[0], "pStyle")[0]?.getAttribute("w:val") ?? "";
    const m = /^(?:Heading|제목)\s*(\d)$/i.exec(style) ?? /^Title$/i.exec(style);
    return m ? (m[1] ? Number(m[1]) : 1) : 0;
  };

  const lines: string[] = [];
  for (const el of kids(body)) {
    const tag = name(el);
    if (tag === "p") {
      const t = paraText(el).trim();
      if (!t) continue;
      const h = heading(el);
      lines.push(h ? `${"#".repeat(Math.min(6, h))} ${t}` : t);
    } else if (tag === "tbl") {
      for (const tr of W(el, "tr")) {
        const cells = W(tr, "tc").map((tc) =>
          W(tc, "p")
            .map((p) => paraText(p).trim())
            .filter(Boolean)
            .join(" "),
        );
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
    }
  }
  return lines.join("\n");
}

/** 파일 하나를 글로 읽는다. 지원하지 않거나 읽을 글이 없으면 사용자가 읽을 수 있는 오류를 던진다. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`${file.name}: 파일이 너무 커요 (최대 ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB).`);
  }
  const ext = extOf(file.name);
  const buffer = await file.arrayBuffer();
  let text: string;
  // 확장자가 없거나 낯선 이름(링크, 복사본 …)이어도 내용으로 PDF/PowerPoint/Word 를 알아본다.
  const kind = sniffKind(new Uint8Array(buffer)) ?? (ext === "pdf" || ext === "pptx" || ext === "docx" ? ext : null);

  if (kind === "pdf") {
    // pdf.js 는 PDF 를 올릴 때만 불러온다.
    const { openPdf, getPageText } = await import("./pdf");
    const pdf = await openPdf(buffer);
    try {
      const parts: string[] = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        const t = await getPageText(pdf, p);
        if (t) parts.push(`--- p.${p} ---\n${t}`);
        if (parts.join("").length > MAX_CHARS_PER_FILE * 1.2) break; // 이미 충분히 김
      }
      text = parts.join("\n\n");
    } finally {
      void pdf.loadingTask.destroy();
    }
  } else if (kind === "pptx") {
    const deck = parsePptx(buffer);
    text = deck.slides.map((s) => `--- 슬라이드 ${s.number} ---\n${s.text}`).join("\n\n");
  } else if (kind === "docx") {
    text = docxToText(buffer);
  } else if (ext === "doc" || ext === "ppt" || ext === "hwp" || ext === "hwpx" || ext === "xls" || ext === "xlsx") {
    throw new Error(`${file.name}: 이 형식은 아직 읽지 못해요. PDF나 글 파일로 저장해서 올려 주세요.`);
  } else {
    const bytes = new Uint8Array(buffer);
    const known = TEXT_EXT.has(ext) || file.type.startsWith("text/");
    if (!known && looksBinary(bytes)) {
      throw new Error(
        `${file.name}: 글을 읽을 수 없는 파일이에요. 문서(PDF, Word, PowerPoint)나 글 파일(md, txt …)을 올려 주세요.`,
      );
    }
    if (known && looksBinary(bytes)) throw new Error(`${file.name}: 글 파일이 아니라 바이너리 파일이에요.`);
    text = decodeText(bytes);
  }

  text = text.replace(/\r\n?/g, "\n").trim();
  if (!text) throw new Error(`${file.name}: 읽을 수 있는 글이 없어요. (스캔된 그림 문서일 수 있어요)`);
  const truncated = text.length > MAX_CHARS_PER_FILE;
  return {
    id: newId(),
    name: file.name,
    text: truncated ? text.slice(0, MAX_CHARS_PER_FILE) : text,
    chars: text.length,
    truncated,
  };
}

/** 질문에 함께 보낼 첨부: 전체 글자 수 한도를 넘지 않게 뒤쪽을 줄인다. */
export function fitAttachments(list: Attachment[]): { name: string; text: string; cut: boolean }[] {
  let left = MAX_CHARS_TOTAL;
  return list.map((a) => {
    const take = Math.max(0, Math.min(a.text.length, left));
    left -= take;
    return { name: a.name, text: a.text.slice(0, take), cut: take < a.chars };
  });
}
