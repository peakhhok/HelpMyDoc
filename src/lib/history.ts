import type { ChatMessage } from "./anthropicApi";

/** 화면에 보이는 메시지. 질문에는 AI 에게 실제로 보여준 문서 범위(ref)가 붙는다. */
export interface UiMessage extends ChatMessage {
  ref?: { from: number; to: number; selection: boolean; emptyPages: number[] };
}

/** AI 에게 보내는 이전 대화의 한도. 화면과 저장소에는 전체가 남는다. */
export const MAX_HISTORY_MESSAGES = 100;
/** 이전 대화의 총 글자 수 한도 (개수보다 이 한도가 먼저 걸리는 경우가 많다) */
export const MAX_HISTORY_CHARS = 60_000;

/**
 * 이전 대화 중 최근 것만 남긴다. 메시지 수와 총 글자 수 중 먼저 걸리는 한도를 따르며,
 * 가장 최근 메시지 하나는 길어도 항상 남긴다. 잘린 결과가 assistant 로 시작하면
 * 질문 없는 답변이 되므로 그 메시지는 버려 항상 user 로 시작하게 한다.
 */
export function trimHistory<T extends ChatMessage>(
  history: T[],
  { maxMessages = MAX_HISTORY_MESSAGES, maxChars = MAX_HISTORY_CHARS } = {},
): T[] {
  let chars = 0;
  let start = history.length;
  while (start > 0 && history.length - start < maxMessages) {
    const next = chars + history[start - 1].content.length;
    if (next > maxChars && start < history.length) break;
    chars = next;
    start--;
  }
  const tail = history.slice(start);
  return tail[0]?.role === "assistant" ? tail.slice(1) : tail;
}

const PAGE_RE = /\b(?:pp?)\.\s?(\d{1,5})(?:\s?[–-]\s?\d{1,5})?/g;

/**
 * 답변 속 `p.120`, `p.120–125` 를 클릭 가능한 링크(`#page-120`)로 바꾼다.
 * 문서 범위를 벗어난 번호와 코드(``` 블록, `인라인`) 안의 텍스트는 그대로 둔다.
 */
export function linkifyPages(markdown: string, numPages: number): string {
  if (numPages < 1) return markdown;
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? part
        : part.replace(PAGE_RE, (match, first: string) => {
            const n = Number(first);
            return n >= 1 && n <= numPages ? `[${match}](#page-${n})` : match;
          }),
    )
    .join("");
}
