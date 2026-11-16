const MAX_CHARS_PER_PAGE = 12000;

export interface BuiltContext {
  /** AI 에게 보낼 문맥 + 질문 */
  prompt: string;
  /** UI 에 보여줄 참조 범위 */
  from: number;
  to: number;
  /** 추출된 텍스트가 없는 쪽(스캔본 등) */
  emptyPages: number[];
  /** 문서 개요(스캔 결과)가 포함됐는가 */
  overview: boolean;
  /** 사용자가 쓴 메모(현재 페이지 메모, 표시에 붙인 메모)가 포함됐는가 */
  notes: boolean;
}

/** XML 속성값으로 안전하게 넣기 위한 이스케이프 (파일 이름에 따옴표 등이 있어도 구조가 깨지지 않게) */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 현재 페이지 ±radius 의 텍스트와 (있다면) 선택한 텍스트를 질문 앞에 붙인다.
 * pdf.js 에 의존하지 않도록 페이지 수와 텍스트 조회 함수를 주입받는다.
 */
export async function buildPrompt(opts: {
  numPages: number;
  getPageText: (page: number) => Promise<string>;
  fileName: string;
  currentPage: number;
  radius: number;
  selection: string;
  question: string;
  /** 문서 스캔으로 만든 개요 (없으면 빈 문자열) */
  overview?: string;
  /** 사용자가 쓴 메모: 페이지 번호와 내용 (참조 범위 안의 것만 호출한 쪽에서 골라 준다) */
  notes?: Array<{ page: number; text: string }>;
}): Promise<BuiltContext> {
  const { numPages, getPageText, fileName, currentPage, radius, selection, question } = opts;
  const overview = (opts.overview ?? "").trim();
  const notes = (opts.notes ?? []).filter((n) => n.text.trim());
  const from = Math.max(1, currentPage - radius);
  const to = Math.min(numPages, currentPage + radius);

  const pages: string[] = [];
  const emptyPages: number[] = [];
  for (let p = from; p <= to; p++) {
    let text = await getPageText(p);
    if (!text) emptyPages.push(p);
    if (text.length > MAX_CHARS_PER_PAGE) text = text.slice(0, MAX_CHARS_PER_PAGE) + "\n…(truncated)";
    pages.push(
      `<page number="${p}"${p === currentPage ? ' current="true"' : ""}>\n${text || "(no extractable text)"}\n</page>`,
    );
  }

  const noteBlock = notes.length
    ? `\n<user_notes>\n` +
      notes.map((n) => `<note page="${n.page}">${escapeAttr(n.text.trim().slice(0, 1500))}</note>`).join("\n") +
      `\n</user_notes>`
    : "";
  const sel = selection.trim() ? `\n<selected_text>\n${selection.trim()}\n</selected_text>\n` : "";
  const prompt =
    (overview ? `${overview}\n\n` : "") +
    `<document_context file="${escapeAttr(fileName)}" total_pages="${numPages}" current_page="${currentPage}">\n` +
    pages.join("\n") +
    `\n</document_context>${noteBlock}${sel}\n\n${question}`;

  return { prompt, from, to, emptyPages, overview: !!overview, notes: notes.length > 0 };
}
