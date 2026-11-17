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
  /** 함께 보낸 "비슷한 내용의 다른 쪽" 번호 */
  related: number[];
  /** 함께 보낸 첨부 파일 이름 */
  attached: string[];
}

/** 지금 쪽과 내용이 비슷해서 함께 보내는 다른 쪽 */
export interface RelatedEntry {
  page: number;
  /** 겹친 용어 */
  terms: string[];
  /** 문서 스캔 때 AI 가 적은 그 쪽의 한 줄 요약 (스캔 전이면 없음) */
  point?: string;
  /** 그 쪽 원문에서 겹친 용어가 몰린 부분 */
  excerpt: string;
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
  /** 내용이 비슷한 다른 쪽 (점수 순) */
  related?: RelatedEntry[];
  /** 사용자가 채팅창에 올린 파일 (글로 바꾼 것). cut 은 길어서 뒤를 줄였다는 뜻 */
  attachments?: Array<{ name: string; text: string; cut?: boolean }>;
}): Promise<BuiltContext> {
  const { numPages, getPageText, fileName, currentPage, radius, selection, question } = opts;
  const overview = (opts.overview ?? "").trim();
  const notes = (opts.notes ?? []).filter((n) => n.text.trim());
  const related = opts.related ?? [];
  const attachments = (opts.attachments ?? []).filter((a) => a.text.trim());
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

  const attachBlock = attachments.length
    ? `<attached_files note="${escapeAttr(
        "사용자가 이 대화에 올린 참고 파일입니다. 질문과 관련이 있으면 이 내용을 근거로 답하세요.",
      )}">\n` +
      attachments
        .map((a) => `<file name="${escapeAttr(a.name)}"${a.cut ? ' truncated="true"' : ""}>\n${a.text}\n</file>`)
        .join("\n") +
      `\n</attached_files>\n\n`
    : "";
  const relatedBlock = related.length
    ? `\n<related_pages note="${escapeAttr(
        "지금 보는 쪽과 내용이 비슷한 다른 쪽을 자동으로 찾은 것입니다. 앞에서 이미 나온 내용과 연결해 설명할 때 (p.N) 형식으로 쪽 번호를 밝혀 주세요. 정확한 내용은 document_context 의 원문을 우선하세요.",
      )}">\n` +
      related
        .map(
          (r) =>
            `<related page="${r.page}"${r.terms.length ? ` terms="${escapeAttr(r.terms.join(", "))}"` : ""}>\n` +
            (r.point ? `[요약] ${r.point}\n` : "") +
            `${r.excerpt}\n</related>`,
        )
        .join("\n") +
      `\n</related_pages>`
    : "";
  const noteBlock = notes.length
    ? `\n<user_notes>\n` +
      notes.map((n) => `<note page="${n.page}">${escapeAttr(n.text.trim().slice(0, 1500))}</note>`).join("\n") +
      `\n</user_notes>`
    : "";
  const sel = selection.trim() ? `\n<selected_text>\n${selection.trim()}\n</selected_text>\n` : "";
  const prompt =
    (overview ? `${overview}\n\n` : "") +
    attachBlock +
    `<document_context file="${escapeAttr(fileName)}" total_pages="${numPages}" current_page="${currentPage}">\n` +
    pages.join("\n") +
    `\n</document_context>${relatedBlock}${noteBlock}${sel}\n\n${question}`;

  return {
    prompt,
    from,
    to,
    emptyPages,
    overview: !!overview,
    notes: notes.length > 0,
    related: related.map((r) => r.page),
    attached: attachments.map((a) => a.name),
  };
}
