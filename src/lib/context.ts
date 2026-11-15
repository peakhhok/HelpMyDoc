import type { PDFDocumentProxy } from "pdfjs-dist";
import { getPageText } from "./pdf";

const MAX_CHARS_PER_PAGE = 12000;

export interface BuiltContext {
  /** Claude 에게 보낼 문맥 + 질문 */
  prompt: string;
  /** UI 에 보여줄 참조 범위 */
  from: number;
  to: number;
  emptyPages: number[];
}

/** 현재 페이지 ±radius 의 텍스트와 (있다면) 선택한 텍스트를 질문 앞에 붙인다. */
export async function buildPrompt(opts: {
  doc: PDFDocumentProxy;
  fileName: string;
  currentPage: number;
  radius: number;
  selection: string;
  question: string;
}): Promise<BuiltContext> {
  const { doc, fileName, currentPage, radius, selection, question } = opts;
  const from = Math.max(1, currentPage - radius);
  const to = Math.min(doc.numPages, currentPage + radius);

  const pages: string[] = [];
  const emptyPages: number[] = [];
  for (let p = from; p <= to; p++) {
    let text = await getPageText(doc, p);
    if (!text) emptyPages.push(p);
    if (text.length > MAX_CHARS_PER_PAGE) text = text.slice(0, MAX_CHARS_PER_PAGE) + "\n…(truncated)";
    pages.push(`<page number="${p}">\n${text || "(no extractable text)"}\n</page>`);
  }

  const sel = selection.trim() ? `\n<selected_text>\n${selection.trim()}\n</selected_text>\n` : "";
  const prompt =
    `<document_context file="${fileName}" total_pages="${doc.numPages}" current_page="${currentPage}">\n` +
    pages.join("\n") +
    `\n</document_context>${sel}\n\n${question}`;

  return { prompt, from, to, emptyPages };
}
